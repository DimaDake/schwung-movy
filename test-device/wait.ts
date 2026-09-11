/* Condition waits with a FRAME budget, never a wall clock.
 *
 * A frame is the shim's SPI period (~2.9 ms), so a budget is a quantity of
 * device work rather than of dev-machine time, and it is the same unit the
 * daemon's WAIT_FRAME speaks. A sleep asserts nothing; `until` fails with the
 * value it was still seeing, which is the diagnostic a sleep can never give. */
type FrameSource = { frames(n: number): Promise<number> };

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
