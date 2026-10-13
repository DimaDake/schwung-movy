import { mlog } from '../log.js';
import { ledBudgetTake } from '../seq/led-cache.js';

/* White intensity scale (knobs 1-4) — always lit so row is identifiable */
function whiteLevel(nv: number): number {
    if (nv < 0.33)  return 124;  // DarkGrey  #1A1A1A
    if (nv < 0.67)  return 118;  // LightGrey #595959
    return 120;                   // White     #FFFFFF
}

/* Amber intensity scale (knobs 5-8) — always lit so row is identifiable */
function amberLevel(nv: number): number {
    if (nv < 0.25)  return 75;   // very dark amber  #403302
    if (nv < 0.5)   return 29;   // mustard           #876700
    if (nv < 0.75)  return 6;    // ochre             #C19D08
    return 3;                     // bright orange     #FF9900
}

let logTickCount = 0;

/* Our own diff cache, not schwung's. setLED/setButtonLED come from
 * input_filter.mjs, whose module-level cache we cannot invalidate — and the
 * host's overtake entry LED-clear writes straight through
 * move_midi_internal_send without updating it. Any path where that cache
 * outlives a hardware clear would leave it claiming a colour the knob no
 * longer shows. So we keep force=true to bypass it and diff here instead,
 * the same arrangement seq/led-cache.ts uses. */
const lastKnobColor = new Array(8).fill(-1);

/* The suites' reset between cases. */
export function resetKnobLedCache(): void {
    lastKnobColor.fill(-1);
}

/* Scratch, because this runs on every rendered frame and the arrays would
 * otherwise be two allocations per frame for eight numbers. */
const scratchColor = new Array(8).fill(0);
const scratchNv: (number | null)[] = new Array(8).fill(null);

/* One knob's colour. `null` means nothing is bound there, or the value has not
 * been read back yet — both go dark, because colour 0 already reads as "turning
 * this does nothing" and lighting an unread cell at the bottom of its range
 * would be a confident lie. */
function knobColor(physK: number, nv: number | null): number {
    if (nv === null || nv === undefined || !isFinite(nv)) return 0;
    return physK < 4 ? whiteLevel(nv) : amberLevel(nv);
}

/*
 * THE ONE WRITER FOR THE EIGHT KNOB LEDS. Two writers on eight LEDs is exactly
 * how a knob ends up claiming a colour it no longer shows: each keeps a cache
 * the other never invalidates.
 */
function writeKnobRow(colors: number[], nvs: (number | null)[]): void {
    logTickCount++;
    const doLog = (logTickCount % 344) === 1; // log ~once per second
    for (let physK = 0; physK < 8; physK++) {
        const color = colors[physK];
        if (lastKnobColor[physK] !== color) {
            /* Two packets per knob, and they come after the pad painters —
             * a cold frame must not spend the buffer they still need. */
            if (!ledBudgetTake(2)) continue;
            lastKnobColor[physK] = color;
            /* notes 0-7: knob touch LEDs */
            setLED(physK, color, true);
            /* CC 71-78: knob indicator LEDs (same physical knob, different LED channel) */
            setButtonLED(MoveKnob1 + physK, color, true);
            /* A CHANGE IS LOGGED AS IT HAPPENS, beside the periodic sample: the
             * row is only written on a rendered frame, and an idle page renders
             * almost none, so a sample alone can miss the row lighting up when
             * a page finishes loading. */
            if (!doLog) mlog('knobLED k=' + physK + ' nv=' + (nvs[physK] ?? -1).toFixed(2) + ' color=' + color);
        }
        if (doLog) {
            mlog('knobLED k=' + physK + ' nv=' + (nvs[physK] ?? -1).toFixed(2)
                 + ' color=' + color);
        }
    }
}

/** Set the LED under each of the 8 knobs from the drawn page: eight normalised
 *  values, `null` (dark) where the drawn cell carries nothing. Knobs 1-4 →
 *  white intensity, 5-8 → amber. Diffed against our own cache (lastKnobColor)
 *  so a host-side LED clear can never strand a knob dark. */
export function updateKnobLEDsFrom(levels: readonly (number | null)[]): void {
    for (let physK = 0; physK < 8; physK++) {
        scratchNv[physK] = levels[physK] ?? null;
        scratchColor[physK] = knobColor(physK, scratchNv[physK]);
    }
    writeKnobRow(scratchColor, scratchNv);
}

/** Light exactly one knob at `nv` (0..1) and darken the other seven.
 *
 *  For pages whose controls are not a 2x4 grid of params — the Global Params
 *  flags list drives one knob and scrolls with the jog. Two things at once:
 *  the brightness carries the value, and being the ONLY lit knob is what says
 *  which knob the page is on. Goes through the same `lastKnobColor` diff as the
 *  grid above, so leaving this page relights the grid rather than inheriting a
 *  stale cache. */
export function updateSingleKnobLED(knob: number, nv: number): void {
    for (let k = 0; k < 8; k++) {
        const color = k === knob ? whiteLevel(nv) : 0;
        if (lastKnobColor[k] === color) continue;
        if (!ledBudgetTake(2)) continue;
        lastKnobColor[k] = color;
        setLED(k, color, true);
        setButtonLED(MoveKnob1 + k, color, true);
    }
}
