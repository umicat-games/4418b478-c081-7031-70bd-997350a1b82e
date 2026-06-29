# Catopia — Technical Session Notes

## What game is this?
**Title**: Catopia
**Genre**: Nurturing / Social / Simulation
**Core mechanic**: Player cares for an AI-driven child spirit on a pixel-art island. The child has autonomous daily behavior (algorithmic layer) and AI-powered conversation (AI layer). Player farms, gathers, builds, and shops to provide for the child.

## Features currently implemented
- **Click-to-talk AI dialog — Cato (2026-06-29, SDK 1.0.27)** — click the cat (`catContains` world hit-test) → the chat HUD widgets **slide up from the bottom** (`Back.easeOut`) + an HTML `<input>` overlays the chat-input box for typing → type + Enter → **the AI (Cato) replies** (`umicat.ai.npc({ playbook:'cato', … })`, a real LLM call; player pays credits, needs sign-in) → Esc / click-outside slides it back down. **The cat is named Cato**; the bond is **guardian ↔ guarded spirit** (Pokémon-like, NOT parent/child) — defined in `public/playbooks/cato.md` (tune Cato's whole personality there, no code; an inline `role`/`style` is also passed as a preview-safe fallback if the playbook can't load).
  - **Dialog widgets** (`game-hud.json`, authored `visible:false`): `chat-message` panel + `chat-input` panel (both wood-box 9-slice regions) + a `chat-text` widget (role `chat-text`, dynamic-bound to registry `catoDialogText`, **`wrapWidth:640`** so replies wrap). `GameScene.openDialog/closeDialog` show/hide + slide them via `getHudObject(this, role)` for roles `['chat-message','chat-input','chat-text']`, remembering each resting y (`dialogY`) to slide back to.
  - **Pointer lock kept while typing** — opening the dialog does NOT `exitPointerLock` (keyboard input goes to the focused `<input>` regardless of pointer lock), so the custom game cursor doesn't pop back to the host cursor. `updateEdgeScroll` early-returns while `dialogOpen` so moving the mouse mid-chat doesn't pan.
  - **The HTML `<input>` is a stopgap** — positioned over the chat-input box via the FIT-scale + letterbox-centre mapping. The proper fix (in progress) is a real HUD **`text-input` widget** (wraps a synced DOM input for IME, SDK does the screen mapping, editor-authorable) — see design 16; once it lands the hand-rolled `showDialogInput`/`positionDialogInput` go away. Design: `umicat-design/features/visual-editor/16-editor-hide-lock.md`.
- Scene-as-data world with two tilemap layers: `water` and `grass-island`
- Scene JSON defines world (1280×720), camera bounds, and tilemap-ref entities
- **3× camera zoom** — each 16×16 source tile renders as 48×48 px on screen; `roundPixels = true` for crisp pixel art
- **Child spirit sprite** (`premium_character_spritesheet`, role=`child`) placed at island center (496, 302)
- **Wandering AI** — child walks automatically in random directions (55 px/s), changing direction every 1.5–3.5s; plays the matching `walk-down/up/left/right` animation based on the dominant velocity axis
- **Player-controlled camera** — **edge-scroll on desktop/mouse** (RTS / theme-park style: cursor within `EDGE_MARGIN`=48px of a canvas edge → camera scrolls that way at `EDGE_SPEED`=900 screen-px/s, driven per-frame in `updateEdgeScroll`, so holding at the edge keeps moving). **Edge-scroll ONLY runs while the mouse is pointer-LOCKED (2026-06-27)** — `updateEdgeScroll` early-returns when `!this.locked` and reads the virtual cursor (always clamped inside the canvas). Before this, the unlocked real mouse drove edge-scroll, so the camera kept moving when the cursor sat at — or left through — the window edge (the "mouse off-screen still pans" bug). Click the canvas to capture first; **drag-to-pan on TOUCH only** (Rex Pan gated by `pointer.wasTouch`; touch never locks, unaffected); double-tap/double-click → smooth snap to cat (Quad.easeOut 520ms); "Find cat" pill button top-right. Edge-scroll + drag are inert in edit mode (SDK `setActive(false)` freezes the scene's update + input)
- **Pointer lock + custom cursor (desktop)** — click the canvas → `requestPointerLock()` captures the mouse (web-game standard; **Esc** releases). While locked a VIRTUAL cursor (`vcursor`) is driven by relative mouse deltas, clamped to the canvas so it can't leave; edge-scroll + HUD hit-testing read it. The custom cursor renders in a dedicated **`CursorScene`** (top overlay, `bringToTop` each frame) so it sits ABOVE the HUD; texture key `cursor` (the user's `triangle_mouse_icon_1.png`, loaded in BootScene), `CURSOR_SCALE`=2, hotspot top-left, placeholder arrow if the asset is missing. HUD clicks under lock are routed via `handleLockedClick` (virtual-cursor hit-test against `findCatBounds`). **NOTE:** pointer lock in the editor's iframe needs home-ui's iframe to carry both `allow="pointer-lock"` AND `sandbox="… allow-pointer-lock"` (the sandbox token is a separate gate) — shipped in home-ui `GameDetail.tsx`.
- **Camera bounds = the WATER tilemap's extent** (`fitCameraBoundsToContent`, `WATER_ENTITY_ID`): water is the world's outer edge, so the camera view can never pan past the ocean (no void). Falls back to the tight union of all world content (no padding) if the water layer can't be measured. The scene's default bounds `(0,0,worldW,worldH)` only covered the positive quadrant — content at negative coords was unreachable, which this fixes.
- **Camera opens CENTRED on the cat** — `setScroll(child.x - w/2, child.y - h/2)` (origin-0.5 centring form, NOT `/zoom`), clamped to bounds. `snapToChild` uses the same form. `originTopLeftScroll()` (pin world origin to the corner) still exists for the loading-frame pre-scroll + as a coord-checking option, but is no longer the initial view. Do NOT use `camera.setOrigin(0,0)` — it breaks tilemap culling (tiles vanish); compensate scroll for Phaser's centre-zoom instead.
- **Tilemap collision** — child is blocked by grass island boundary tiles (`grass_tiles_v2` solid tiles with sub-tile collisionRects); uses `addTilemapCollider` + `applyAssetHitbox` from SDK
- Immediate direction change when child hits a boundary (via `body.blocked.*` check in `update()`)

## Key implementation details
- `GameScene.ts`: loads world scene via SDK, sets 3× zoom + roundPixels, wires wandering behavior
- Entity lookup by role (`byRole('child')`) — never by entity ID
- Asset hitbox applied via `applyAssetHitbox` (asset has vision-authored foot-area hitbox: x=19,y=28,w=8,h=4)
- Grass-island tilemap entity ID: `e-mqveju7y-sk2r` (used in `addTilemapCollider`)
- Water tilemap entity ID: `e-mqvdaooj-fzpk` (`WATER_ENTITY_ID`, used for camera bounds). **Both ids are hardcoded** — if a tilemap is deleted + re-drawn its id changes; the camera-bounds path then falls back to the content union, collision would need the new id.
- Sprite entity: `e-mqvfwxir-fuj2`, role=`child`, assetId=`premium_character_spritesheet`
- `BootScene.ts`: loads manifest + the `cursor` texture, starts GameScene
- `CursorScene.ts`: top-overlay scene that renders the custom pointer-lock cursor above the HUD (reads `registry.get('cursor')` published by GameScene). Registered in `main.ts`; GameScene launches it.
- Scene file: `public/scenes/world/main.json`
- Design doc: `docs/design.md`

## What was changed this turn
- **Camera control overhaul**: edge-scroll (desktop) + touch drag, **pointer lock + custom triangle cursor** (`CursorScene`, above HUD), **camera bounds clamped to the water tilemap** (can't pan past the ocean), **opens centred on the cat**.

## Debug stance (NOT shipping behaviour)
- `CHILD_WANDER = false` pins the cat at spawn (for verifying world coords against the editor rulers). Flip to `true` to restore roaming.
