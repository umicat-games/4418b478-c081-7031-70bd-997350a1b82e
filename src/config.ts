import { ORIENTATION_DIMENSIONS, type Orientation } from '@umicat/phaser-sdk';

// __ORIENTATION_LINE__ — overwritten by the agent-session-service scaffold
// when a new game is created (gitManager.createGameFromFork). Edit ORIENTATION
// here only if you know what you're doing — every scene was laid out for the
// orientation chosen at game creation, and switching it mid-development will
// almost certainly break layouts.
export const ORIENTATION: Orientation = 'landscape';

export const GAME_WIDTH = ORIENTATION_DIMENSIONS[ORIENTATION].width;
export const GAME_HEIGHT = ORIENTATION_DIMENSIONS[ORIENTATION].height;

// Adaptive-zoom reference (RESIZE mode). At the DESIGN canvas (GAME_WIDTH×HEIGHT)
// the camera zoom is DESIGN_ZOOM, i.e. we target showing
// ~(GAME_WIDTH/DESIGN_ZOOM)×(GAME_HEIGHT/DESIGN_ZOOM) world px on any screen.
// `GameScene.computeZoom` targets it; `createUmicatGame({ referenceZoom })` hands
// it to the SDK so the editor's "Camera screen" rect shows the design view
// (1280/3 × 720/3 = 427×240) instead of the arbitrary editor-canvas size.
export const DESIGN_ZOOM = 3;
