/* Sequencer-owned hardware constants. Defined locally (not via injected
 * schwung globals) so seq modules run unmodified in browser tests. Values
 * match schwung/src/shared/constants.mjs. */

export const STEP_NOTE_BASE = 16;   // step buttons = notes 16..31, each with an LED
export const NUM_STEP_BUTTONS = 16;
export const STEPS_PER_BAR = 16;    // fixed 1/16 grid
export const MAX_STEPS = 256;       // 16 bars; mirrors engine clip::MAX_STEPS

export const PAD_MIN = 68;          // 32-pad grid = notes 68..99
export const PAD_MAX = 99;
export const CC_NOTE_SESSION = 50;  // Note/Session toggle

export const CC_PLAY = 85;
export const CC_REC = 86;
export const CC_TRACK_START = 40;   // CC 43 = track 0 … CC 40 = track 3
export const CC_TRACK_END = 43;
export const CC_MUTE = 88;

/* Shifted step functions, 0-indexed. Here rather than in router.ts because the
 * quantize overlay's input classifier needs the same list, and router.ts
 * imports that overlay — reading them from router would be a module cycle. */
export const STEP_CLIP_PARAMS = 2;   // Shift+Step 3  — Clip Params page
export const STEP_METRO = 5;         // Shift+Step 6  — Metronome
export const STEP_FULL_VEL = 9;      // Shift+Step 10 — Full Velocity
export const STEP_DOUBLE_LOOP = 14;  // Shift+Step 15 — Double Loop
export const STEP_QUANTIZE = 15;     // Shift+Step 16 — Quantize

/* Shift+Step 5/7/9 all open the Main Params page (page 0). The map keeps room
 * for future pages — point a step at a different page index here. */
export const MAIN_PAGE_STEPS: Record<number, number> = { 4: 0, 6: 0, 8: 0 };

/* Must match ENGINE_VERSION in engine/crates/movy-dsp/src/lib.rs —
 * build-dsp.sh fails the build when they diverge. The UI re-issues the DSP
 * load until ping returns this exact version (fixes the fire-and-forget
 * load race and stale engines after redeploy). */
export const ENGINE_VERSION = '0.43.0';
export const ENGINE_DSP_PATH = '/data/UserData/schwung/modules/tools/movy/dsp.so';

/* Where the engine finds schwung's chain host, and where it may keep its own
 * copy of it. The copy exists so movy's chain instances get their own dlopen
 * mapping (and their own g_host) instead of clobbering the pointer schwung's
 * four slot instances share; the engine keeps it in step with the install, so
 * it tracks whatever chain-host version the user has. */
export const CHAIN_MODULE_DIR = '/data/UserData/schwung/modules/chain';
export const MOVY_MODULE_DIR  = '/data/UserData/schwung/modules/tools/movy';
