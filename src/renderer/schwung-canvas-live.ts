/* schwung-canvas-live.ts — a fullscreen canvas's live values (`onValues`).
 *
 * Upstream's contract (shadow_ui.js tickCanvasLiveValues): a canvas declaring
 * `fullscreen_live_ms` and `extra_keys` is handed fresh readings of those keys
 * every interval through its `onValues` hook. Without it a script that draws
 * from what `onValues` delivers is frozen on its `onOpen` snapshot — breakbeat's
 * playback status never moved and its slice editor never showed an edit.
 *
 * ONE READ PER TICK, never the whole set at once, as upstream: a read is a
 * round trip, and four in one tick is a stall that lands on the frame every
 * interval — a visible hitch on exactly the animated views this exists for.
 */

export interface LiveCycle {
    keys: string[];
    intervalMs: number;
    last: number;
    cursor: number;
    values: Record<string, string | null>;
}

/** The cycle a canvas's declaration asks for, or null when it asks for none. */
export function liveCycleFor(meta: any): LiveCycle | null {
    const ms = meta ? Number(meta.fullscreen_live_ms) : 0;
    const keys = meta && Array.isArray(meta.extra_keys) ? meta.extra_keys.slice(0, 4).map(String) : [];
    if (!(ms > 0) || keys.length === 0) return null;
    return { keys, intervalMs: Math.max(50, ms), last: 0, cursor: 0, values: {} };
}

/** Advance one read. Returns the full set when the cycle completes, else null. */
export function stepLive(c: LiveCycle, read: (k: string) => string | null,
                         now: number): Record<string, string | null> | null {
    if (c.cursor === 0) {
        if (now - c.last < c.intervalMs) return null;
        c.last = now;
        c.values = {};
    }
    const key = c.keys[c.cursor];
    c.values[key] = read(key);
    c.cursor++;
    if (c.cursor < c.keys.length) return null;
    c.cursor = 0;
    return c.values;
}
