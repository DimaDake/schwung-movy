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

/** Set the LED under each of the 8 knobs based on current param values.
 *  Knobs 1-4 (physK 0-3) → white intensity; knobs 5-8 (physK 4-7) → amber intensity.
 *  Uses both note-based (0-7) and CC-based (71-78) LED addresses since the
 *  visible hardware LED type is not confirmed. force=true bypasses the LED
 *  cache so Move firmware's per-frame touch-state updates don't win. */
export function updateKnobLEDs(vm: ViewModel): void {
    logTickCount++;
    const doLog = (logTickCount % 344) === 1; // log ~once per second
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
            const physK = row * 4 + col;
            const pvm   = vm.rows[row][col];
            const color = pvm === null ? 0
                : row === 0 ? whiteLevel(pvm.normalizedValue)
                : amberLevel(pvm.normalizedValue);
            /* notes 0-7: knob touch LEDs */
            setLED(physK, color, true);
            /* CC 71-78: knob indicator LEDs (same physical knob, different LED channel) */
            setButtonLED(MoveKnob1 + physK, color, true);
            if (doLog) mlog('knobLED k=' + physK + ' nv=' + (pvm?.normalizedValue ?? -1).toFixed(2) + ' color=' + color);
        }
    }
}
