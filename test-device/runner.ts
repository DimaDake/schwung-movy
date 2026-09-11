import { mkdirSync } from 'node:fs';
import type { Check, ScenarioResult } from './types.js';
import { printLevel0, writeReport } from './report.js';

export type Ctx = {
    bus: any;
    agent: any;
    host: string;
    check(id: string, label: string, pass: boolean,
          detail?: { expected?: string; actual?: string; frame?: number }): void;
    note(k: string, v: unknown): void;
    need: { register(undo: () => Promise<void>): void };
};

type Entry = { name: string; fn: (t: Ctx) => Promise<void> };
let registry: Entry[] = [];

export function scenario(name: string, fn: (t: Ctx) => Promise<void>): void {
    registry.push({ name, fn });
}

/* One scenario body run once per value — how a scenario covers all three
 * schwunggrid renderers without being written three times. */
export function scenarioEach<T>(values: T[], name: string,
                                fn: (t: Ctx, v: T) => Promise<void>): void {
    for (const v of values) registry.push({ name: `${name}[${String(v)}]`, fn: (t) => fn(t, v) });
}

export function _resetForTest(): void { registry = []; }

export async function runAll(opts: {
    host: string;
    only?: string;
    outDir?: string;
    bus?: any;
    agent?: any;
    /* Cheap invariant check run between scenarios. A scenario that corrupts
     * state then costs ONE reseed rather than poisoning the sweep — which is
     * what keeps dirty-tracking isolation honest. */
    beforeEach?: () => Promise<void>;
}): Promise<number> {
    const outDir = opts.outDir ?? '.test-out';
    mkdirSync(outDir, { recursive: true });
    const results: ScenarioResult[] = [];

    for (const e of registry) {
        if (opts.only && !e.name.startsWith(opts.only)) continue;
        const checks: Check[] = [];
        const notes: Record<string, unknown> = {};
        const undos: Array<() => Promise<void>> = [];
        const t0 = Date.now();
        let error: string | undefined;

        const ctx: Ctx = {
            bus: opts.bus, agent: opts.agent, host: opts.host,
            check: (id, label, pass, d) => { checks.push({ id, label, pass, ...d }); },
            note: (k, v) => { notes[k] = v; },
            need: { register: (u) => { undos.push(u); } },
        };

        try {
            if (opts.beforeEach) await opts.beforeEach();
            await e.fn(ctx);
        } catch (err) {
            error = err instanceof Error ? (err.stack ?? err.message) : String(err);
        }

        /* Unwind LIFO whatever happened. A scenario that threw is exactly when
         * the device is most likely to be left dirty, so teardown must not be
         * conditional on success. An undo that itself throws is recorded and
         * the remaining ones still run. */
        for (let i = undos.length - 1; i >= 0; i--) {
            try { await undos[i](); }
            catch (err) { notes[`undo_error_${i}`] = String(err); }
        }

        const r: ScenarioResult = {
            name: e.name, checks, error, seconds: (Date.now() - t0) / 1000, notes,
        };
        results.push(r);
        printLevel0(r, outDir);
    }

    writeReport(outDir, results);
    const failed = results.reduce(
        (a, r) => a + r.checks.filter((c) => !c.pass).length + (r.error ? 1 : 0), 0);
    const total = results.reduce((a, r) => a + r.checks.length, 0);
    console.log(`\n${results.length} scenarios · ${total} checks · ${failed} failed   → ${outDir}/run.md`);
    return failed;
}
