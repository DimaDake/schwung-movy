/* Host-only: exercises the runner's bookkeeping with no device. */
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { scenario, runAll, _resetForTest } from '../dist/runner.js';

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
    host: 'fake', outDir: OUT, beforeEach: async () => { beforeEachCalls++; },
});

ok('failing checks and throws are both counted', failures === 2, `failures=${failures}`);
ok('beforeEach runs once per scenario', beforeEachCalls === 3, `calls=${beforeEachCalls}`);
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

rmSync(OUT, { recursive: true, force: true });
console.log(fails === 0 ? 'RUNNER SELFTEST PASSED' : `${fails} RUNNER CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
