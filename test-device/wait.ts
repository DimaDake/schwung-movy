/* Condition waits with a FRAME budget, never a wall clock.
 *
 * A frame is the shim's SPI period (~2.9 ms), so a budget is a quantity of
 * device work rather than of dev-machine time, and it is the same unit the
 * daemon's WAIT_FRAME speaks. A sleep asserts nothing; `until` fails with the
 * value it was still seeing, which is the diagnostic a sleep can never give. */
type FrameSource = { frames(n: number): Promise<number> };

/* Frames of silence a poll must leave between reads of an overtake_dsp param.
 *
 * That SHM is a SINGLE SLOT shared with movy's own writes, so a read issued
 * while movy is writing starves the write outright — it is lost, not delayed.
 * Measured twice, on both halves of the channel: eight probe requests spaced by
 * a bare WAIT_FRAME all answered while a 30-frame poll loop answered the first
 * few and then never again (probe.ts); and, on the command half, a Play press
 * landed 12/12 with this gap and 0/12 at `every: 30` — movy retried its `cmd`
 * batch every tick for 400 ms and never once claimed the slot.
 *
 * So this is the poll rate for anything reading `overtake_dsp:*`, not a probe
 * detail. ~150 frames is ~435 ms, which is the real cost of that single slot.
 * Reads that do NOT touch it — the daemon's STATE, a log grep over ssh — are
 * free to poll as fast as they like. */
export const PARAM_POLL_GAP = 150;

export class WaitBudgetExceeded extends Error {
    constructor(readonly what: string, readonly budget: number, readonly last: unknown) {
        super(`waited ${budget} frames for ${what}; last saw ${JSON.stringify(last)}`);
        this.name = 'WaitBudgetExceeded';
    }
}

export async function until<T>(
    bus: FrameSource,
    what: string,
    probe: () => Promise<T>,
    pred: (v: T) => boolean,
    opts: { within?: number; every?: number } = {},
): Promise<T> {
    const within = opts.within ?? 700;   // ~2 s of device frames
    const every  = opts.every ?? 2;
    let spent = 0;
    let last: T = await probe();
    if (pred(last)) return last;
    while (spent < within) {
        await bus.frames(every);
        spent += every;
        last = await probe();
        if (pred(last)) return last;
    }
    throw new WaitBudgetExceeded(what, within, last);
}

/* For state with no single predicate — "whatever it becomes, it has stopped
 * becoming it". Two identical consecutive reads. */
export async function untilStable<T>(
    bus: FrameSource,
    what: string,
    probe: () => Promise<T>,
    opts: { within?: number; every?: number } = {},
): Promise<T> {
    let prev = JSON.stringify(await probe());
    return until(bus, what, probe, (v) => {
        const now = JSON.stringify(v);
        const same = now === prev;
        prev = now;
        return same;
    }, opts);
}
