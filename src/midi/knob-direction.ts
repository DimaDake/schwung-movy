/* A worn encoder reports some of its counts BACKWARDS, in bursts (schwung
 * #658, measured on a real Move's knob 1). Schwung's knob_direction_filter
 * holds those back, at the price of lag on a deliberate reversal, so it is OFF
 * unless this device asks for it: the file KNOB_FILTER_FLAG_PATH, empty for
 * every knob or listing knob numbers ("1,4"). One file for both hosts, so a
 * device set up under Schwung behaves the same in movy.
 *
 * It sits in front of EVERY knob consumer -- the router's first look at CC
 * 71-78, ahead of the generator preview and every page -- not only the Schwung
 * grid as in shadow_ui: a knob is worn on the mixer and Main Params too. Read
 * at boot; a change applies from the next open. */
import { platform } from '../platform/index.js';
import { schwungLib } from '../renderer/schwung-lib.js';

interface KnobFilter { accept(knob: number, delta: number): boolean; reset(knob: number): void }

let filter: KnobFilter | null = null;
let knobs = new Set<number>();

export function loadKnobDirectionFilter(): void {
    const lib = schwungLib();
    const path = lib.KNOB_FILTER_FLAG_PATH;
    let text: string | null = null;
    try { if (platform.fileExists(path)) text = platform.readFile(path) ?? ''; } catch { text = null; }
    const cfg = lib.parseKnobFilterConfig(text);
    filter = cfg.enabled ? lib.createKnobDirectionFilter() : null;
    knobs = cfg.knobs;
}

/** True when `data` is a knob count held back as a misread: the caller
 *  CONSUMES it, or a second handler would act on it. A touch-down is a new
 *  gesture, whose direction is committed afresh; it always passes on. */
export function knobDirectionHeld(data: number[]): boolean {
    if (!filter) return false;
    const [status, d1, d2] = data;
    if ((status & 0xF0) === 0x90 && d1 < 8 && d2 > 0 && knobs.has(d1)) filter.reset(d1);
    if ((status & 0xF0) !== 0xB0 || d1 < MoveKnob1 || d1 >= MoveKnob1 + 8) return false;
    const k = d1 - MoveKnob1;
    return knobs.has(k) && !filter.accept(k, decodeDelta(d2));
}
