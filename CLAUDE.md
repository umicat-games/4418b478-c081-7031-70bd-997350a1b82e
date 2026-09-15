# Umicat asset pack

An Umicat Asset Store pack (ADR-036) — a curated bundle of art, audio, or 3D
models with no code. This file is what the agent reads first.

## Where things are

| | |
|---|---|
| `public/` | every file that's actually part of the pack — this folder structure IS what a buyer browses after acquiring it |
| `pack.json` | the pack's own manifest: name, description, modality, category, tags |

There is no `src/`, no build step, and nothing runs. Saving files here is the
whole job — review and publishing happen elsewhere on the platform.

## modality

A pack is single-modality: `"image"` (2D), `"audio"`, or `"model"` (3D). Set
it in `pack.json` once the first real pieces exist and don't mix kinds.

## Update this file

After a session that adds or reorganizes content, update this file with a
short note on what the pack contains now and what's still planned — the next
session (yours or the user's) starts by reading it.
