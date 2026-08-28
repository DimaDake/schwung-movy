/* Stand-in for Schwung's shared param_pages when no schwung checkout is
 * available (SCHWUNG unset). Importing it is harmless; CALLING it is not, so it
 * throws rather than drawing something misleading — a stubbed grid that renders
 * blank would read as "the swap works and looks empty". */
export const BAND_H = null;
export function renderPageMovy() {
    throw new Error(
        'Schwung param_pages not available: rebuild with SCHWUNG=/path/to/schwung ' +
        'to exercise the Schwung knob grid.');
}
