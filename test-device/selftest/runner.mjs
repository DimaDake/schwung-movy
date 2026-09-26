/* Host-only: exercises the runner's bookkeeping with no device. */
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { scenario, runAll, _resetForTest } from '../dist/runner.js';
import { TransportError } from '../dist/errors.js';

let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const OUT = '/tmp/movy-test-out-selftest';
rmSync(OUT, { recursive: true, force: true });
_resetForTest();

const unwound = [];
scenario('green', async (t) => {
    t.need.register(async () => unwound.push('green-undo'));
    t.check('a', 'a holds', true);
});
scenario('red', async (t) => {
    t.need.register(async () => unwound.push('red-undo-1'));
    t.need.register(async () => unwound.push('red-undo-2'));
    t.check('b', 'b holds', false, { expected: '>=3', actual: '1' });
});
scenario('boom', async (t) => {
    t.need.register(async () => unwound.push('boom-undo'));
    throw new Error('scenario exploded');
});

let beforeEachCalls = 0;
const failures = await runAll({
    host: 'fake', outDir: OUT, flakeLog: null, beforeEach: async () => { beforeEachCalls++; },
});

ok('failing checks and throws are both counted', failures === 2, `failures=${failures}`);
/* 5, not 3: `red` and `boom` each fail and are retried once. */
ok('beforeEach runs once per attempt', beforeEachCalls === 5, `calls=${beforeEachCalls}`);
ok('undo runs on success', unwound.includes('green-undo'));
ok('undo runs after a failed check', unwound.includes('red-undo-1'));
ok('undo runs after a thrown scenario', unwound.includes('boom-undo'), unwound.join(','));
ok('undo unwinds LIFO',
    unwound.indexOf('red-undo-2') < unwound.indexOf('red-undo-1'), unwound.join(','));

ok('a level-1 artifact exists per scenario', existsSync(`${OUT}/red.md`));
const red = readFileSync(`${OUT}/red.md`, 'utf8');
ok('the artifact carries expected vs actual',
    /expected: `>=3`/.test(red) && /actual: `1`/.test(red), red.slice(0, 160));
ok('the artifact anchors the check id', /\{#b\}/.test(red));
const boom = readFileSync(`${OUT}/boom.md`, 'utf8');
ok('a thrown scenario records its stack', /scenario exploded/.test(boom));
ok('a run summary exists', existsSync(`${OUT}/run.json`));

/* ---- retry policy ---------------------------------------------------- */

_resetForTest();
const OUT2 = '/tmp/movy-test-out-selftest-retry';
rmSync(OUT2, { recursive: true, force: true });

let assertTries = 0, infraTries = 0, alwaysTries = 0, infraAlwaysTries = 0;
const order = [];

scenario('assert-flake', async (t) => {
    assertTries++;
    order.push(`assert-flake:${assertTries}`);
    t.need.register(async () => order.push(`assert-flake-undo:${assertTries}`));
    t.check('v', 'value arrived', assertTries > 1, { expected: '7', actual: '0' });
});
scenario('assert-hard', async (t) => {
    alwaysTries++;
    t.check('w', 'never holds', false, { expected: '7', actual: '0' });
});
scenario('infra-flake', async (t) => {
    infraTries++;
    if (infraTries < 3) throw new TransportError('testd: connection closed');
    t.check('x', 'reached the device', true);
});
scenario('infra-hard', async () => {
    infraAlwaysTries++;
    throw new TransportError('testd: connect timeout');
});

let beforeEach2 = 0;
const failures2 = await runAll({
    host: 'fake', outDir: OUT2, flakeLog: null, beforeEach: async () => { beforeEach2++; },
});

ok('an assert failure is retried once', assertTries === 2, `tries=${assertTries}`);
ok('a scenario that passes on retry does not fail the run', failures2 === 2,
   `failures=${failures2}`);
ok('an assert failure that stays red is not retried forever', alwaysTries === 2,
   `tries=${alwaysTries}`);
ok('an infra failure is retried harder than an assert one', infraTries === 3,
   `tries=${infraTries}`);
ok('infra retries are bounded too', infraAlwaysTries === 3, `tries=${infraAlwaysTries}`);
ok('beforeEach reseeds before EVERY attempt, not every scenario',
   beforeEach2 === 2 + 2 + 3 + 3, `calls=${beforeEach2}`);
ok('undo unwinds between attempts',
   order.indexOf('assert-flake-undo:1') < order.indexOf('assert-flake:2'), order.join(','));

const byName2 = Object.fromEntries(
    JSON.parse(readFileSync(`${OUT2}/run.json`, 'utf8')).map((r) => [r.name, r]));
ok('a pass-on-retry is reported FLAKY, not pass',
   byName2['assert-flake'].status === 'flaky', byName2['assert-flake'].status);
ok('an infra-only retry that lands is a plain pass',
   byName2['infra-flake'].status === 'pass', byName2['infra-flake'].status);
ok('a red scenario is fail', byName2['assert-hard'].status === 'fail');
ok('every attempt is kept, not just the last',
   byName2['assert-flake'].attempts.length === 2,
   JSON.stringify(byName2['assert-flake'].attempts.map((a) => a.n)));
ok('the failed attempt records WHY it was retried',
   byName2['infra-flake'].attempts[0].kind === 'infra'
   && byName2['assert-flake'].attempts[0].kind === 'assert',
   `${byName2['infra-flake'].attempts[0].kind}/${byName2['assert-flake'].attempts[0].kind}`);
ok('the flaky scenario names the check that flaked',
   byName2['assert-flake'].attempts[0].checks.some((c) => c.id === 'v' && !c.pass));

const flakyMd = readFileSync(`${OUT2}/assert-flake.md`, 'utf8');
ok('the artifact says it was flaky and on which attempt',
   /FLAKY/.test(flakyMd) && /attempt 1/.test(flakyMd), flakyMd.slice(0, 200));

/* Retries are what make the tier a gate rather than a smoke check, so being
 * able to switch them off has to be deliberate and visible. */
_resetForTest();
let noRetryTries = 0;
scenario('no-retry', async (t) => {
    noRetryTries++;
    t.check('v', 'value arrived', noRetryTries > 1);
});
await runAll({ host: 'fake', outDir: OUT2, flakeLog: null, retries: { assert: 0, infra: 0 } });
ok('retries can be switched off for debugging', noRetryTries === 1, `tries=${noRetryTries}`);

/* A scenario MARKED known-flaky: retried harder, and a red that survives the
 * retries is reported but does not fail the tier. The mark is per scenario and
 * carries its reason, so it cannot quietly spread to the others. */
_resetForTest();
let kfTries = 0, kfLateTries = 0, plainTries = 0;
scenario('kf-red', async (t) => { kfTries++; t.check('k', 'never holds', false); },
         { knownFlaky: 'teardown park race' });
scenario('kf-late', async (t) => { kfLateTries++; t.check('k', 'third time', kfLateTries >= 3); },
         { knownFlaky: 'teardown park race' });
scenario('plain-red', async (t) => { plainTries++; t.check('p', 'never holds', false); });
const failures3 = await runAll({ host: 'fake', outDir: OUT2, flakeLog: null });
ok('a known-flaky scenario is retried more than once', kfTries === 4, `tries=${kfTries}`);
ok('...and can land on a later retry', kfLateTries === 3, `tries=${kfLateTries}`);
ok('an unmarked scenario keeps the single retry', plainTries === 2, `tries=${plainTries}`);
ok('a known-flaky red does not fail the run; an unmarked one still does', failures3 === 1,
   `failures=${failures3}`);
const byName3 = Object.fromEntries(
    JSON.parse(readFileSync(`${OUT2}/run.json`, 'utf8')).map((r) => [r.name, r]));
ok('the known-flaky red is still recorded as a fail, with its reason',
   byName3['kf-red'].status === 'fail' && byName3['kf-red'].knownFlaky === 'teardown park race',
   JSON.stringify({ s: byName3['kf-red'].status, k: byName3['kf-red'].knownFlaky }));
ok('its artifact says it is known-flaky',
   /KNOWN FLAKY/.test(readFileSync(`${OUT2}/kf-red.md`, 'utf8')));

rmSync(OUT2, { recursive: true, force: true });

rmSync(OUT, { recursive: true, force: true });
console.log(fails === 0 ? 'RUNNER SELFTEST PASSED' : `${fails} RUNNER CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
