import { mkdirSync } from 'node:fs';
import type { Bus } from './bus.js';
import type { Agent } from './agent.js';
import type { Attempt, Check, FailKind, ScenarioResult, Status } from './types.js';
import { isInfraError } from './errors.js';
import { printLevel0, printSummary, writeReport } from './report.js';
import { drainWaitStats } from './wait.js';
import { recordRun } from './flake-log.js';

export type Ctx = {
    bus: Bus;
    agent: Agent;
    host: string;
    check(id: string, label: string, pass: boolean,
          detail?: { expected?: string; actual?: string; frame?: number }): void;
    note(k: string, v: unknown): void;
    need: { register(undo: () => Promise<void>): void };
};

/* `knownFlaky` is the reason a scenario is exempt from gating — a stop-gap
 * while its flake is investigated, not a verdict. It buys KNOWN_FLAKY_RETRIES
 * assert retries, and a red that survives them is still reported (and lands
 * in the ledger) but does not fail the tier. Remove the mark with the fix. */
type ScenarioOpts = { knownFlaky?: string };
type Entry = { name: string; fn: (t: Ctx) => Promise<void> } & ScenarioOpts;
let registry: Entry[] = [];

export function scenario(name: string, fn: (t: Ctx) => Promise<void>, opts: ScenarioOpts = {}): void {
    registry.push({ name, fn, ...opts });
}

/* One scenario body run once per value — how a scenario covers both
 * schwunggrid renderers without being written twice. */
export function scenarioEach<T>(values: T[], name: string,
                                fn: (t: Ctx, v: T) => Promise<void>): void {
    for (const v of values) registry.push({ name: `${name}[${String(v)}]`, fn: (t) => fn(t, v) });
}

export function _resetForTest(): void { registry = []; }

/* Retry budgets, per scenario, counted separately by cause.
 *
 * An `infra` failure — a dropped ssh, a closed socket — says nothing about
 * movy, so it is worth retrying hard and it does not colour the result. An
 * `assert` failure is the device's own answer, including a wait that ran out
 * of frames, and "the value never arrived" is exactly how a real regression
 * looks: retry it ONCE, to separate a race from a break, and mark the scenario
 * FLAKY when the second attempt lands. Anything more and the tier is just
 * grinding until it goes green. */
const DEFAULT_RETRIES = { assert: 1, infra: 2 };
const KNOWN_FLAKY_RETRIES = 3;

export async function runAll(opts: {
    host: string;
    only?: string;
    outDir?: string;
    bus?: any;
    agent?: any;
    /* Cheap invariant check run before every ATTEMPT. A scenario that corrupts
     * state then costs ONE reseed rather than poisoning the sweep — which is
     * what keeps dirty-tracking isolation honest, and what makes a retry a
     * fresh run rather than a second pass over the first one's wreckage. */
    beforeEach?: () => Promise<void>;
    retries?: { assert?: number; infra?: number };
    /* null keeps a run out of the ledger — how the host-only selftest exercises
     * the runner without polluting the record of the real device. */
    flakeLog?: string | null;
}): Promise<number> {
    const outDir = opts.outDir ?? '.test-out';
    const budget = { ...DEFAULT_RETRIES, ...(opts.retries ?? {}) };
    mkdirSync(outDir, { recursive: true });
    const results: ScenarioResult[] = [];

    for (const e of registry) {
        if (opts.only && !e.name.startsWith(opts.only)) continue;
        results.push(await runScenario(e, opts, outDir, budget));
    }

    writeReport(outDir, results);
    recordRun(results, opts.host, opts.flakeLog === undefined ? undefined : opts.flakeLog);
    const failed = countFailures(results);
    printSummary(results, failed, outDir);
    return failed;
}

function countFailures(results: ScenarioResult[]): number {
    return results.filter((r) => !r.knownFlaky).reduce(
        (a, r) => a + r.checks.filter((c) => !c.pass).length + (r.error ? 1 : 0), 0);
}

async function runScenario(
    e: Entry,
    opts: { bus?: any; agent?: any; host: string; beforeEach?: () => Promise<void> },
    outDir: string,
    budget: { assert: number; infra: number },
): Promise<ScenarioResult> {
    const attempts: Attempt[] = [];
    /* A switched-off budget stays off: `retries: { assert: 0 }` is a debugging
     * request, and the mark must not override it. */
    const left = { ...budget };
    if (e.knownFlaky && left.assert > 0) left.assert = Math.max(left.assert, KNOWN_FLAKY_RETRIES);

    for (let n = 1; ; n++) {
        const attempt = await runAttempt(e, opts, n);
        attempts.push(attempt);
        if (!attempt.kind) break;
        if (left[attempt.kind] <= 0) break;
        left[attempt.kind]--;
    }

    const last = attempts[attempts.length - 1];
    const status: Status = last.kind ? 'fail'
        : attempts.some((a) => a.kind === 'assert') ? 'flaky' : 'pass';

    const r: ScenarioResult = {
        name: e.name, status, checks: last.checks, error: last.error, attempts,
        seconds: attempts.reduce((a, x) => a + x.seconds, 0), notes: last.notes,
        ...(e.knownFlaky ? { knownFlaky: e.knownFlaky } : {}),
    };
    printLevel0(r, outDir);
    return r;
}

async function runAttempt(
    e: Entry,
    opts: { bus?: any; agent?: any; host: string; beforeEach?: () => Promise<void> },
    n: number,
): Promise<Attempt> {
    const checks: Check[] = [];
    const notes: Record<string, unknown> = {};
    const undos: Array<() => Promise<void>> = [];
    const t0 = Date.now();
    let error: string | undefined;
    let kind: FailKind | undefined;

    const ctx: Ctx = {
        bus: opts.bus, agent: opts.agent, host: opts.host,
        check: (id, label, pass, d) => { checks.push({ id, label, pass, ...d }); },
        note: (k, v) => { notes[k] = v; },
        need: { register: (u) => { undos.push(u); } },
    };

    drainWaitStats();   /* anything left over belongs to the previous attempt */
    try {
        if (opts.beforeEach) await opts.beforeEach();
        await e.fn(ctx);
    } catch (err) {
        error = err instanceof Error ? (err.stack ?? err.message) : String(err);
        kind = isInfraError(err) ? 'infra' : 'assert';
    }
    if (!kind && checks.some((c) => !c.pass)) kind = 'assert';

    /* Waits that nearly ran out. Not a failure — a forecast of one. */
    const near = drainWaitStats();
    if (near.length) {
        notes.waits_near_budget = near
            .sort((a, b) => b.spent / b.within - a.spent / a.within).slice(0, 8);
    }

    /* Unwind LIFO whatever happened. A scenario that threw is exactly when
     * the device is most likely to be left dirty, so teardown must not be
     * conditional on success — and a retry runs on top of this, so it must not
     * be conditional on being the last attempt either. An undo that itself
     * throws is recorded and the remaining ones still run. */
    for (let i = undos.length - 1; i >= 0; i--) {
        try { await undos[i](); }
        catch (err) { notes[`undo_error_${i}`] = String(err); }
    }

    return { n, checks, error, kind, seconds: (Date.now() - t0) / 1000, notes };
}
