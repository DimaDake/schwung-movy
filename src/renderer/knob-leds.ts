import type { ViewModel } from '../types/viewmodel.js';
import { mlog } from '../log.js';

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

/** Set the LED under each of the 8 knobs based on current param values.
 *  Knobs 1-4 (physK 0-3) → white intensity; knobs 5-8 (physK 4-7) → amber intensity.
 *  Uses both note-based (0-7) and CC-based (71-78) LED addresses since the
 *  visible hardware LED type is not confirmed. force=true bypasses schwung's
 *  setLED cache; we diff against our own (see lastKnobColor) so a host-side
 *  LED clear can never strand a knob dark. */
export function updateKnobLEDs(vm: ViewModel): void {
    logTickCount++;
    const doLog = (logTickCount % 344) === 1; // log ~once per second
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
            const physK = row * 4 + col;
            const pvm   = vm.rows[row][col];
            /* A fired trigger flashes its own knob's LED — the one output channel
             * physically under the finger that just turned it. Cooling stays at
             * the dim level rather than going dark: knob-leds keeps every knob lit
             * so the row is identifiable, and colour 0 already means "no param".
             * The LED deliberately ignores the drain — that would mean an LED send
             * every tick for information the screen already carries. */
            const flash = pvm?.trigger === 'fired';
            const color = pvm === null ? 0
                : row === 0 ? (flash ? 120 : whiteLevel(pvm.normalizedValue))
                : (flash ? 3 : amberLevel(pvm.normalizedValue));
            if (lastKnobColor[physK] !== color) {
                lastKnobColor[physK] = color;
                /* notes 0-7: knob touch LEDs */
                setLED(physK, color, true);
                /* CC 71-78: knob indicator LEDs (same physical knob, different LED channel) */
                setButtonLED(MoveKnob1 + physK, color, true);
            }
            if (doLog) mlog('knobLED k=' + physK + ' nv=' + (pvm?.normalizedValue ?? -1).toFixed(2) + ' color=' + color);
        }
    }
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
        lastKnobColor[k] = color;
        setLED(k, color, true);
        setButtonLED(MoveKnob1 + k, color, true);
    }
}
