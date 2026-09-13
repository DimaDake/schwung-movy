import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ScenarioResult } from './types.js';

/* A ledger of what needed a second attempt, and how often.
 *
 * "The device tests are flaky" is unfalsifiable, and unfalsifiable is why the
 * tier stopped being read. A count is not: a check that flaked 3 runs out of 20
 * is a named race with a reproduction rate, and something to go and fix. Kept
 * out of git — it is a property of this machine and this device, not of the
 * source — and capped, because only the recent shape of the run matters. */
const KEEP_RUNS = 50;

export type ScenarioEntry = {
    name: string;
    status: ScenarioResult['status'];
    attempts: number;
    /* Check ids that failed on an attempt the scenario went on to survive. */
    flaked: string[];
    infra: number;
};
export type RunEntry = {
    at: string; host: string; sha: string;
    scenarios: ScenarioEntry[];
};

export function defaultLogPath(): string {
    /* ../ from test-device/dist/ is test-device/. */
    return fileURLToPath(new URL('../.flake-log.json', import.meta.url));
}

function headSha(): string {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'],
                            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return 'unknown'; }
}

export function readLog(path = defaultLogPath()): RunEntry[] {
    if (!existsSync(path)) return [];
    try { return JSON.parse(readFileSync(path, 'utf8')) as RunEntry[]; }
    catch { return []; }   /* a truncated log must never fail a run */
}

export function recordRun(results: ScenarioResult[], host: string,
                          path: string | null = defaultLogPath()): void {
    if (path === null || results.length === 0) return;
    const entry: RunEntry = {
        at: new Date().toISOString(), host, sha: headSha(),
        scenarios: results.map((r) => ({
            name: r.name,
            status: r.status,
            attempts: r.attempts.length,
            flaked: [...new Set(r.attempts.slice(0, -1)
                .flatMap((a) => a.checks.filter((c) => !c.pass).map((c) => c.id)))],
            infra: r.attempts.filter((a) => a.kind === 'infra').length,
        })),
    };
    const log = [...readLog(path), entry].slice(-KEEP_RUNS);
    try { writeFileSync(path, JSON.stringify(log, null, 1)); }
    catch { /* the ledger is a diagnostic, never a reason a sweep fails */ }
}

export type FlakeRow = { key: string; runs: number; flaky: number; failed: number };

/* One row per scenario and one per check id that has ever flaked, so a scenario
 * that flakes for a different reason each time reads differently from one that
 * always trips the same check. */
export function summarize(log: RunEntry[]): FlakeRow[] {
    const rows = new Map<string, FlakeRow>();
    const bump = (key: string, f: (r: FlakeRow) => void) => {
        const r = rows.get(key) ?? { key, runs: 0, flaky: 0, failed: 0 };
        f(r); rows.set(key, r);
    };
    for (const run of log) {
        for (const s of run.scenarios) {
            bump(s.name, (r) => {
                r.runs++;
                if (s.status === 'flaky') r.flaky++;
                if (s.status === 'fail') r.failed++;
            });
            for (const id of s.flaked) bump(`${s.name}#${id}`, (r) => { r.runs++; r.flaky++; });
        }
    }
    return [...rows.values()]
        .filter((r) => r.flaky > 0 || r.failed > 0)
        .sort((a, b) => (b.flaky + b.failed) - (a.flaky + a.failed) || a.key.localeCompare(b.key));
}

export function printFlakes(path = defaultLogPath()): void {
    const log = readLog(path);
    if (log.length === 0) { console.log(`no flake log yet at ${path}`); return; }
    const rows = summarize(log);
    console.log(`${log.length} runs logged (${log[0].at.slice(0, 10)} → ${log[log.length - 1].at.slice(0, 10)})`);
    if (rows.length === 0) { console.log('nothing has flaked or failed in that window'); return; }
    for (const r of rows) {
        const rate = ((r.flaky + r.failed) / r.runs * 100).toFixed(0);
        console.log(`  ${r.key.padEnd(34)} ${String(r.flaky).padStart(3)} flaky  ` +
                    `${String(r.failed).padStart(3)} failed  of ${String(r.runs).padStart(3)} runs  (${rate}%)`);
    }
}
