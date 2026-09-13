/* Host-only: drives a fake frame source, so no device is needed. */
import { until, untilStable, WaitBudgetExceeded, drainWaitStats } from '../dist/wait.js';

let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const fakeBus = () => { const b = { n: 0, frames: async (k) => (b.n += k) }; return b; };

{
    const bus = fakeBus();
    let calls = 0;
    const v = await until(bus, 'counter', async () => ++calls, (x) => x >= 3);
    ok('until resolves on the predicate', v === 3, `got ${v}`);
    ok('until does not overshoot', calls === 3, `calls=${calls}`);
}
{
    /* Already-true on the first probe must cost exactly one probe and ZERO
     * frame waits — otherwise every settled assertion pays a needless
     * round trip, and `until` on an already-met condition is not free. */
    const bus = fakeBus();
    let calls = 0;
    await until(bus, 'already true', async () => ++calls, () => true);
    ok('until probes once when already satisfied', calls === 1, `calls=${calls}`);
    ok('until waits no frames when already satisfied', bus.n === 0, `frames=${bus.n}`);
}
{
    const bus = fakeBus();
    let err = null;
    try { await until(bus, 'never', async () => 'stuck', () => false, { within: 10, every: 2 }); }
    catch (e) { err = e; }
    ok('budget exhaustion throws WaitBudgetExceeded', err instanceof WaitBudgetExceeded);
    ok('the error names what it waited for', !!err && /never/.test(err.message), err?.message);
    ok('the error carries the last value', !!err && err.last === 'stuck', String(err?.last));
    ok('the error names the frame budget', !!err && /10 frames/.test(err.message), err?.message);
}
{
    const bus = fakeBus();
    const seq = [{ a: 1 }, { a: 2 }, { a: 2 }];
    let i = 0;
    const v = await untilStable(bus, 'settling', async () => seq[Math.min(i++, seq.length - 1)]);
    ok('untilStable returns the settled value', v.a === 2, JSON.stringify(v));
}

{
    /* The near-miss detector: a wait that lands with room to spare is silent,
     * one that scrapes in is recorded. Without this, a budget that is about to
     * stop holding is indistinguishable from one that always will. */
    drainWaitStats();
    const bus = fakeBus();
    let calls = 0;
    await until(bus, 'comfortable', async () => ++calls, (x) => x >= 2, { within: 100, every: 2 });
    ok('a wait with room to spare is not recorded', drainWaitStats().length === 0);

    calls = 0;
    await until(bus, 'scraped in', async () => ++calls, (x) => x >= 41, { within: 100, every: 2 });
    const near = drainWaitStats();
    ok('a wait that nearly ran out IS recorded', near.length === 1, JSON.stringify(near));
    ok('the record names the wait and both numbers',
       near[0]?.what === 'scraped in' && near[0]?.spent === 80 && near[0]?.within === 100,
       JSON.stringify(near[0]));
    ok('draining clears the record', drainWaitStats().length === 0);

    let threw = false;
    try { await until(bus, 'never', async () => 0, () => false, { within: 10, every: 2 }); }
    catch { threw = true; }
    ok('a wait that ran OUT is a failure, not a near miss',
       threw && drainWaitStats().length === 0);
}

console.log(fails === 0 ? 'WAIT SELFTEST PASSED' : `${fails} WAIT CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
