import type { ViewModel } from '../types/viewmodel.js';

/* White intensity scale (knobs 1-4) — palette indices from constants.mjs */
function whiteLevel(nv: number): number {
    if (nv <= 0)    return 0;    // off
    if (nv < 0.33)  return 124;  // DarkGrey  #1A1A1A
    if (nv < 0.67)  return 118;  // LightGrey #595959
    return 120;                   // White     #FFFFFF
}

/* Amber intensity scale (knobs 5-8) */
function amberLevel(nv: number): number {
    if (nv <= 0)    return 0;    // off
    if (nv < 0.25)  return 75;   // very dark amber  #403302
    if (nv < 0.5)   return 29;   // mustard           #876700
    if (nv < 0.75)  return 6;    // ochre             #C19D08
    return 3;                     // bright orange     #FF9900
}

/** Set the LED under each of the 8 knobs based on current param values.
 *  Knobs 1-4 (physK 0-3) → white intensity; knobs 5-8 (physK 4-7) → amber intensity.
 *  LED note positions match the capacitive touch notes (0-7). */
export function updateKnobLEDs(vm: ViewModel): void {
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
            const physK = row * 4 + col;
            const pvm   = vm.rows[row][col];
            const nv    = pvm?.normalizedValue ?? 0;
            const color = row === 0 ? whiteLevel(nv) : amberLevel(nv);
            setLED(physK, color, false);
        }
    }
}
