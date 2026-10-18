/* Loop-mode note view layout: the watched clip's notes folded Push-style (only
 * pitches the clip uses get a row) and stretched over the Loop strip's window,
 * so the bars line up with the strip's segments under them. Pure: notes and a
 * window in, rectangles out — the drawer (note-view.ts) owns the screen.
 *
 * Aggregation when pixels run out:
 *  - more present pitches than rows fit → neighbours share a row;
 *  - every note gets at least one column, and a column where two or more notes
 *    of a row meet is HATCHED, so "many short notes" never reads as one long
 *    one. Hatching costs one fill_rect per pixel row of a run, where the mock's
 *    checkerboard cost one per pixel. */

export const NV_TOP = 0;
export const NV_BOT = 58;            // row 59 is the gap above the strip band
const SPAN = NV_BOT - NV_TOP + 1;
const ROW_CAP = 12;                  // max row pitch (note + 1 px gap)
const MAX_ROWS = (SPAN + 1) >> 1;    // a 1 px note needs a 1 px gap too
const TICKS_PER_BAR = 16 * 24;       // mirror of seq-core

export interface NoteEv { tick: number; gate: number; pitch: number }
/** The strip's window: first shown bar, bar count, pixels per bar. */
export interface NoteWindow { fromBar: number; bars: number; segW: number }
/** One horizontal span of a row: solid, or hatched where notes pile up. */
export interface NoteRun { x: number; w: number; y0: number; h: number; hatched: boolean }

export interface NoteLayout { runs: NoteRun[]; noteH: number }

function foldRows(notes: NoteEv[]): { rowOf: Map<number, number>; rows: number } {
    const pitches = [...new Set(notes.map((n) => n.pitch))].sort((a, b) => a - b);
    const per = Math.max(1, Math.ceil(pitches.length / MAX_ROWS));
    const rowOf = new Map<number, number>();
    pitches.forEach((p, i) => rowOf.set(p, Math.floor(i / per)));
    return { rowOf, rows: Math.ceil(pitches.length / per) };
}

export function layoutNotes(notes: NoteEv[], win: NoteWindow): NoteLayout {
    const runs: NoteRun[] = [];
    if (notes.length === 0 || win.bars <= 0) return { runs, noteH: 0 };
    const { rowOf, rows } = foldRows(notes);
    const rowH = Math.min(ROW_CAP, Math.max(2, Math.floor((SPAN + 1) / rows)));
    const noteH = rowH - 1;
    const vw = win.segW * win.bars;
    const t0 = win.fromBar * TICKS_PER_BAR;
    const total = win.bars * TICKS_PER_BAR;
    const xOf = (t: number) => Math.floor(((t - t0) * vw) / total);
    const cnt = new Uint8Array(vw + 1);
    const start = new Uint8Array(vw + 1);
    const byRow: NoteEv[][] = Array.from({ length: rows }, () => []);
    for (const n of notes) byRow[rowOf.get(n.pitch)!].push(n);
    for (let r = 0; r < rows; r++) {
        cnt.fill(0);
        start.fill(0);
        let any = false;
        for (const n of byRow[r]) {
            const a = xOf(n.tick);
            const b = Math.max(a + 1, xOf(n.tick + Math.max(1, n.gate)));
            if (b <= 0 || a >= vw) continue;
            for (let x = Math.max(0, a); x < Math.min(b, vw); x++) if (cnt[x] < 255) cnt[x]++;
            if (a >= 0) start[a] = 1;
            any = true;
        }
        if (!any) continue;
        const y1 = NV_BOT - r * rowH;
        const y0 = y1 - noteH + 1;
        /* 0 = dark, 1 = solid, 2 = hatched. A start that butts against another
         * note gives up its first column as the gap — only when the note has a
         * second column to show and is alone there, or it would vanish. */
        let runX = 0;
        let runS = 0;
        for (let x = 0; x <= vw; x++) {
            let s = x === vw ? 0 : cnt[x] >= 2 ? 2 : cnt[x] === 1 ? 1 : 0;
            if (s === 1 && start[x] && x > 0 && cnt[x - 1] && cnt[x + 1]) s = 0;
            if (s === runS) continue;
            if (runS) runs.push({ x: runX, w: x - runX, y0, h: noteH, hatched: runS === 2 });
            runX = x;
            runS = s;
        }
    }
    return { runs, noteH };
}

/* The lit pixel spans of one column, top to bottom — what the playhead inverts
 * and later restores, without repainting the whole view. */
export function columnSpans(runs: NoteRun[], x: number): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    for (const r of runs) {
        if (x < r.x || x >= r.x + r.w) continue;
        if (!r.hatched) spans.push([r.y0, r.h]);
        else for (const y of hatchRows(r)) spans.push([y, 1]);
    }
    return spans;
}

/** Hatched runs keep their BOTTOM row lit, so a 1 px row still shows. */
export function hatchRows(r: NoteRun): number[] {
    const ys: number[] = [];
    for (let y = r.y0 + r.h - 1; y >= r.y0; y -= 2) ys.push(y);
    return ys;
}
