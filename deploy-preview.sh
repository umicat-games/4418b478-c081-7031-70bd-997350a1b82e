#!/usr/bin/env bash
# Deploy this game's local build to its in-editor PREVIEW (S3 + CDN).
# Additive sync (no --delete): dist assets are content-hashed so leaving old
# files is harmless; index.html is overwritten no-cache. Then invalidate the
# cdn.umicat.ai CloudFront distribution so the new build serves immediately.
#
# NOTE: this is a TEMPORARY override of the preview. Any session-server
# workspace rebuild (reconnect-for-SDK-update, agent turn, fresh clone) will
# clobber it — the workspace builds from its own checkout, which only pulls
# this branch on a FRESH CLONE (workspace deletion / ~1h idle). For changes to
# stick, get the workspace to re-clone the branch.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GID=837404bf-087b-4773-98fa-083f728eca98
DIST="$REPO/dist"
BUCKET=unboxy-dev
CF_DIST=E31A40598Q73XJ   # cdn.umicat.ai

[ -f "$DIST/index.html" ] || { echo "ERROR: $DIST/index.html missing — run 'npx vite build' first"; exit 1; }

# `dist/assets/` holds TWO different kinds of file and they cannot share a
# cache header. Vite writes its bundles there with a content hash in the name,
# which is what makes `immutable` safe. But `public/assets/` is copied into the
# same directory VERBATIM — `character.glb`, `Textures/` — at fixed paths. Those
# were going out as immutable for a year, so a changed model reached nobody:
# a CloudFront invalidation does not touch a browser cache, and `immutable` is
# the one header that tells a browser not even to revalidate. It had to be
# fixed by hand after every deploy, twenty times, which is a fix that belongs
# in the script.
#
# Split by extension, and the DEFAULT is the safe one: anything here that is
# not a bundle gets `no-cache`. If vite ever starts emitting hashed images into
# this directory they will be revalidated needlessly, which costs a 304. The
# other way round costs a year.
echo "==> sync the content-hashed bundles — immutable"
aws s3 sync "$DIST/assets/" "s3://$BUCKET/previews/$GID/assets/" \
  --exclude "*" --include "*.js" --include "*.css" --include "*.js.map" \
  --cache-control "public,max-age=31536000,immutable"

echo "==> sync everything else under assets/ (models, textures) — no-cache"
aws s3 sync "$DIST/assets/" "s3://$BUCKET/previews/$GID/assets/" \
  --exclude "*.js" --exclude "*.css" --exclude "*.js.map" \
  --cache-control "no-cache"
# One limit of `sync` worth knowing: it will not re-upload a file whose local
# copy is not STRICTLY NEWER than the remote, so it cannot repair the header of
# an object that is already wrong and has not changed since. Fixing a header by
# itself is `aws s3 cp <key> <key> --metadata-directive REPLACE --cache-control
# ...`. Everything currently up there has been corrected once by hand.

# Everything else lives at FIXED paths (index.html, scenes/*.json,
# tilemaps/*.json, uploaded/*, manifest.json). Caching these immutable poisons
# the browser so a rebuilt scene never re-loads — the "edits revert after Build"
# bug. no-cache = the browser must revalidate every load (304 when unchanged).
echo "==> sync fixed-path files (scenes/tilemaps/uploaded/html) — no-cache"
aws s3 sync "$DIST/" "s3://$BUCKET/previews/$GID/" \
  --cache-control "no-cache" \
  --exclude "assets/*"

# `aws s3 sync` compares size+mtime — index.html is ALWAYS the same size (the JS
# hash it references is a fixed-length string), so if the local dist mtime isn't
# strictly newer than S3's, sync SILENTLY SKIPS it and the deployed index.html
# keeps pointing at an OLD JS bundle (the "hard-refresh still shows the old build"
# bug). Force it every time.
echo "==> force index.html (sync can skip it — same size)"
aws s3 cp "$DIST/index.html" "s3://$BUCKET/previews/$GID/index.html" \
  --cache-control "no-cache"

echo "==> invalidate CDN"
aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST" \
  --paths "/previews/$GID/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output table

echo "==> done — hard-refresh the editor (Cmd+Shift+R)"
