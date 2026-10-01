/* Host-only: KNOWN-RED.md rows age into a red tier. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseKnownRed, reportKnownRed, OVERDUE_DAYS } from '../dist/gate-checks.js';

let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const now = new Date('2026-10-10T12:00:00Z');
const md = `# Known red
| since | check | owner | why / next step |
| --- | --- | --- | --- |
| 2026-10-09 | seq/drum-multi-step | session X | gesture lost |
| 2026-10-01 | page-dive/dive-commit | session Y | browser rows |
`;
const rows = parseKnownRed(md, now);
ok('only dated rows are entries', rows.length === 2, JSON.stringify(rows));
ok('age is counted in days', rows[0].ageDays === 1 && rows[1].ageDays === 9, JSON.stringify(rows.map((r) => r.ageDays)));

const dir = mkdtempSync(join(tmpdir(), 'known-red-'));
const p = join(dir, 'KNOWN-RED.md');
writeFileSync(p, md);
ok(`a row older than ${OVERDUE_DAYS} days fails the run`, reportKnownRed(now, p) === 1);
writeFileSync(p, md.split('\n').slice(0, 3).join('\n'));
ok('an empty table fails nothing', reportKnownRed(now, p) === 0);
ok('no file fails nothing', reportKnownRed(now, join(dir, 'absent.md')) === 0);

if (fails) { console.log(`\n${fails} known-red check(s) failed`); process.exit(1); }
console.log('\nknown-red: all checks passed');
