/* Host-only: the flake ledger's bookkeeping, with no device and no real log. */
import { rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { scenario, runAll, _resetForTest } from '../dist/runner.js';
import { readLog, summarize } from '../dist/flake-log.js';

let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const OUT = '/tmp/movy-flake-selftest';
const LOG = '/tmp/movy-flake-selftest.json';
rmSync(OUT, { recursive: true, force: true });
rmSync(LOG, { force: true });

let tries = 0;
_resetForTest();
scenario('wobble', async (t) => {
    tries++;
    t.check('v', 'value arrived', tries > 1, { expected: '7', actual: '0' });
});
scenario('solid', async (t) => { t.check('s', 'holds', true); });

await runAll({ host: 'fake', outDir: OUT, flakeLog: LOG });
tries = 0;
await runAll({ host: 'fake', outDir: OUT, flakeLog: LOG });

const log = readLog(LOG);
ok('one entry per run', log.length === 2, `entries=${log.length}`);
ok('the entry names the host and a sha', log[0].host === 'fake' && !!log[0].sha);
const wob = log[0].scenarios.find((s) => s.name === 'wobble');
ok('a flaky scenario is logged as flaky', wob.status === 'flaky', wob.status);
ok('the ledger names the check that flaked, not just the scenario',
   wob.flaked.join(',') === 'v', wob.flaked.join(','));

const rows = Object.fromEntries(summarize(log).map((r) => [r.key, r]));
ok('the summary counts flakes per scenario across runs',
   rows['wobble'].flaky === 2 && rows['wobble'].runs === 2, JSON.stringify(rows['wobble']));
ok('and per check id', rows['wobble#v'].flaky === 2, JSON.stringify(rows['wobble#v']));
ok('a scenario that never flaked is not in the summary', !rows['solid']);

/* The ledger is a diagnostic. A corrupt one must not take the sweep with it. */
writeFileSync(LOG, '{ this is not json');
ok('a corrupt log reads as empty rather than throwing', readLog(LOG).length === 0);
_resetForTest();
scenario('after', async (t) => { t.check('a', 'holds', true); });
const failuresAfterCorrupt = await runAll({ host: 'fake', outDir: OUT, flakeLog: LOG });
ok('and the run still completes', failuresAfterCorrupt === 0);
ok('and the log is rebuilt', JSON.parse(readFileSync(LOG, 'utf8')).length === 1);

rmSync(OUT, { recursive: true, force: true });
rmSync(LOG, { force: true });
ok('the selftest left no log behind', !existsSync(LOG));
console.log(fails === 0 ? 'FLAKE LOG SELFTEST PASSED' : `${fails} FLAKE LOG CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
