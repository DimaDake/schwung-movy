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

/* Must match ENGINE_VERSION in engine/crates/movy-dsp/src/lib.rs —
 * build-dsp.sh fails the build when they diverge. The UI re-issues the DSP
 * load until ping returns this exact version (fixes the fire-and-forget
 * load race and stale engines after redeploy). */
export const ENGINE_VERSION = '0.26.0';
export const ENGINE_DSP_PATH = '/data/UserData/schwung/modules/tools/movy/dsp.so';
