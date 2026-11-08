/* A playhead drawn as one inverted column over what is under it — the
 * Loop-mode note view's notes, a frozen track's waveform — at the Loop strip's
 * own x (seq/loop-strip.ts `stripPlayheadX`), so the two read as one line.
 * `spans` are that column's lit runs, `[y, h]`. Pure. */
export function paintPlayheadColumn(x: number, top: number, bot: number,
                                    spans: [number, number][], inverted: boolean): void {
    fill_rect(x, top, 1, bot - top + 1, inverted ? 1 : 0);
    for (const [y, h] of spans) {
        const y0 = Math.max(y, top);
        const y1 = Math.min(y + h, bot + 1);
        if (y1 > y0) fill_rect(x, y0, 1, y1 - y0, inverted ? 0 : 1);
    }
}
