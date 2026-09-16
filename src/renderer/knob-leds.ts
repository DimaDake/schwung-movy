import type { ViewModel } from '../types/viewmodel.js';
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

/* Called from invalidateLedCachesOnResume — see the note above. */
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
function knobColor(physK: number, nv: number | null, flash: boolean): number {
    if (nv === null || nv === undefined || !isFinite(nv)) return 0;
    return physK < 4 ? (flash ? 120 : whiteLevel(nv))
                     : (flash ? 3   : amberLevel(nv));
}

/*
 * THE ONE WRITER FOR THE EIGHT KNOB LEDS, whoever supplies the values.
 *
 * Under Schwung's page the values come from the DRAWN cells and under movy's
 * they come from movy's view model, but the row itself — the diff cache above
 * and the frame's LED budget — stays here. Two writers on eight LEDs is exactly
 * how a knob ends up claiming a colour it no longer shows: each keeps a cache
 * the other never invalidates, so leaving one page strands the row on the
 * other's idea of it.
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
        }
        if (doLog) {
            mlog('knobLED k=' + physK + ' nv=' + (nvs[physK] ?? -1).toFixed(2)
                 + ' color=' + color);
        }
    }
}

/** Set the LED under each of the 8 knobs based on current param values.
 *  Knobs 1-4 (physK 0-3) → white intensity; knobs 5-8 (physK 4-7) → amber intensity.
 *  Uses both note-based (0-7) and CC-based (71-78) LED addresses since the
 *  visible hardware LED type is not confirmed. force=true bypasses schwung's
 *  setLED cache; we diff against our own (see lastKnobColor) so a host-side
 *  LED clear can never strand a knob dark. */
export function updateKnobLEDs(vm: ViewModel): void {
    for (let physK = 0; physK < 8; physK++) {
        const pvm = vm.rows[physK >> 2][physK & 3];
        /* A fired trigger flashes its own knob's LED — the one output channel
         * physically under the finger that just turned it. Cooling stays at
         * the dim level rather than going dark: knob-leds keeps every knob lit
         * so the row is identifiable, and colour 0 already means "no param".
         * The LED deliberately ignores the drain — that would mean an LED send
         * every tick for information the screen already carries. */
        scratchNv[physK] = pvm ? pvm.normalizedValue : null;
        scratchColor[physK] = knobColor(physK, scratchNv[physK], pvm?.trigger === 'fired');
    }
    writeKnobRow(scratchColor, scratchNv);
}

/** The same row, lit from a page movy did not plan: eight normalised values,
 *  `null` where the drawn cell carries nothing. There is no trigger flash here
 *  — a trigger badge is movy's own decoration on movy's own view model. */
export function updateKnobLEDsFrom(levels: readonly (number | null)[]): void {
    for (let physK = 0; physK < 8; physK++) {
        scratchNv[physK] = levels[physK] ?? null;
        scratchColor[physK] = knobColor(physK, scratchNv[physK], false);
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
