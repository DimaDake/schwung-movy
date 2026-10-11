/* Wall-clock phases of a scenario attempt (fixture, open, close, ...). The
 * tier spends most of its time outside the checks, and without a breakdown
 * "it is slow" has no address. Drained per attempt by the runner into
 * notes.timings and printed after any scenario that took long. */
type Span = { label: string; ms: number };
let spans: Span[] = [];

export async function timed<T>(label: string, f: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try { return await f(); } finally { spans.push({ label, ms: Date.now() - t0 }); }
}

export function drainTimings(): Span[] {
    const out = spans;
    spans = [];
    return out;
}

/* "open 3 x 2.1s · fixture.verifyChains 1 x 14.0s" — summed per label, longest first. */
export function summarize(list: Span[]): string {
    const by = new Map<string, { n: number; ms: number }>();
    for (const s of list) {
        const e = by.get(s.label) ?? { n: 0, ms: 0 };
        e.n++; e.ms += s.ms; by.set(s.label, e);
    }
    return [...by.entries()].sort((a, b) => b[1].ms - a[1].ms)
        .map(([l, e]) => `${l} ${e.n}x ${(e.ms / 1000).toFixed(1)}s`).join(' · ');
}
