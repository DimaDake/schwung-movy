/* View model for the post-capture overlay. Two shapes behind one structure:
 * a row of tempo candidates to choose from, or a "played → set" pair with an
 * explanation when the tempo was not ours to change. */

import { captureState } from './capture.js';

export interface CaptureVM {
    /* Right side of the header: the bar count when the tempo is up for grabs,
     * otherwise why it is not. */
    header: string;
    /* Big-font values laid out left to right. */
    values: string[];
    /* Index into `values` drawn inverted in a solid box. */
    selIdx: number;
    /* True when `values` is a "played → set" pair rather than a choice. */
    pair: boolean;
    caption: string;
}

export function buildCaptureVM(): CaptureVM {
    const s = captureState;
    if (s.overlay === 'select') {
        return {
            header: s.bars > 0 ? s.bars + (s.bars === 1 ? ' BAR' : ' BARS') : '',
            values: s.cands.map(String),
            selIdx: Math.max(0, Math.min(s.cands.length - 1, s.idx)),
            pair: false,
            caption: 'JOG PICKS TEMPO',
        };
    }
    // Fixed: the take was read at `detected` and re-timed onto `bpm`. Showing
    // both is the explanation — one number alone would look like a choice.
    const pct = Math.round(Math.abs(s.stretchPermille) / 10);
    return {
        header: s.why === 'ext' ? 'EXT SYNC' : 'CLIP HAS NOTES',
        values: [String(s.detected), String(s.bpm)],
        selIdx: 1,
        pair: true,
        caption: pct > 0 ? 'STRETCHED ' + pct + '% TO FIT' : 'FITTED TO THE SET TEMPO',
    };
}
