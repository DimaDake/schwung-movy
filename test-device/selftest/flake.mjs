/* Host-only: the flake ledger's bookkeeping, with no device and no real log. */
import { rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { scenario, runAll, _resetForTest } from '../dist/runner.js';
import { readLog, summarize, printFlakes } from '../dist/flake-log.js';

let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const OUT = '/tmp/movy-flake-selftest';
const LOG = '/tmp/movy-flake-selftest.json';
rmSync(OUT, { recursive: true, force: true });
rmSync(LOG, { force: true });

let tries = 0;
/* Armed for the first two runs and disarmed for the third, so `wobble` flaked in
 * 2 of the 3 runs it was observed in. That gap is the whole point: a check id
 * only ever lands in the ledger when it FLAKED, so a run count taken from the
 * flake itself is always equal to the flake count, and the gap is what tells the
 * two apart. */
let flakeArmed = true;
_resetForTest();
scenario('wobble', async (t) => {
    tries++;
    t.check('v', 'value arrived', !flakeArmed || tries > 1, { expected: '7', actual: '0' });
});
scenario('solid', async (t) => { t.check('s', 'holds', true); });

await runAll({ host: 'fake', outDir: OUT, flakeLog: LOG });
tries = 0;
await runAll({ host: 'fake', outDir: OUT, flakeLog: LOG });
flakeArmed = false;
tries = 0;
await runAll({ host: 'fake', outDir: OUT, flakeLog: LOG });

const log = readLog(LOG);
ok('one entry per run', log.length === 3, `entries=${log.length}`);
ok('the entry names the host and a sha', log[0].host === 'fake' && !!log[0].sha);
const wob = log[0].scenarios.find((s) => s.name === 'wobble');
ok('a flaky scenario is logged as flaky', wob.status === 'flaky', wob.status);
ok('the ledger names the check that flaked, not just the scenario',
   wob.flaked.join(',') === 'v', wob.flaked.join(','));

const rows = Object.fromEntries(summarize(log).map((r) => [r.key, r]));
ok('the summary counts flakes per scenario across runs',
   rows['wobble'].flaky === 2 && rows['wobble'].runs === 3, JSON.stringify(rows['wobble']));
ok('and per check id', rows['wobble#v'].flaky === 2, JSON.stringify(rows['wobble#v']));
/* THE DENOMINATOR IS THE SCENARIO'S RUNS, NOT THE FLAKE'S OWN COUNT. Incrementing
 * `runs` beside `flaky` in the same statement made every check row print 100% by
 * construction and left it unable to say anything about the runs it passed. */
ok('a check row is over the scenario\'s runs, not over its own flakes',
   rows['wobble#v'].runs === 3, JSON.stringify(rows['wobble#v']));
ok('so a check row can read below 100%', rows['wobble#v'].flaky < rows['wobble#v'].runs,
   `${rows['wobble#v'].flaky}/${rows['wobble#v'].runs}`);
ok('a scenario that never flaked is not in the summary', !rows['solid']);

/* The ledger is a diagnostic. A corrupt one must not take the sweep with it. */
writeFileSync(LOG, '{ this is not json');
ok('a corrupt log reads as empty rather than throwing', readLog(LOG).length === 0);
_resetForTest();
scenario('after', async (t) => { t.check('a', 'holds', true); });
const failuresAfterCorrupt = await runAll({ host: 'fake', outDir: OUT, flakeLog: LOG });
ok('and the run still completes', failuresAfterCorrupt === 0);
ok('and the log is rebuilt', JSON.parse(readFileSync(LOG, 'utf8')).length === 1);

/* VALID JSON, WRONG SHAPE — the case that actually happened, and the one this
 * suite could not see. The ledger was re-serialised as an object by a hand-edit;
 * it parses perfectly, so the `catch` above never fires, and it then reached
 * `[...readLog(p), entry]` and threw. That killed a whole tier AFTER all 18
 * scenarios had run and BEFORE the summary printed: no summary, no report
 * pointer, no exit code. Only a shape check stops it, and only a case like this
 * proves the shape check is there. */
writeFileSync(LOG, JSON.stringify({ 0: { at: 'x', host: 'fake', sha: 'x', scenarios: [] } }));
ok('an object-shaped ledger reads as empty rather than throwing',
   readLog(LOG).length === 0);
/* `--flakes` rides the same read, so it has to survive it too. Its output is
 * captured rather than printed, so a regression shows up as a failed assertion
 * instead of a stray line in the suite's own log. */
const flakesSaid = (() => {
    const real = console.log; const seen = [];
    console.log = (...a) => { seen.push(a.join(' ')); };
    try { printFlakes(LOG); } finally { console.log = real; }
    return seen.join('\n');
})();
ok('and --flakes survives it', flakesSaid.includes('no flake log yet'), flakesSaid);
_resetForTest();
scenario('after-shape', async (t) => { t.check('a', 'holds', true); });
const failuresAfterShape = await runAll({ host: 'fake', outDir: OUT, flakeLog: LOG });
ok('and the run still completes over it', failuresAfterShape === 0);
ok('and the log is rebuilt as an ARRAY, not an object',
   Array.isArray(JSON.parse(readFileSync(LOG, 'utf8'))));

rmSync(OUT, { recursive: true, force: true });
rmSync(LOG, { force: true });
ok('the selftest left no log behind', !existsSync(LOG));
console.log(fails === 0 ? 'FLAKE LOG SELFTEST PASSED' : `${fails} FLAKE LOG CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
