import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioResult } from './types.js';

/* Three levels, one rule: EVIDENCE IS CAPTURED ALWAYS, PRINTED NEVER.
 *
 * Level 0 (stdout) is the only thing read by default, so a green sweep stays a
 * handful of lines and a failure's FIRST line is diagnostic on its own. Having
 * to re-run a device suite to find out what broke — plus the ssh log greps that
 * follow — is the cost this design exists to remove. */
const GRN = '\x1b[32m', RED = '\x1b[31m', RST = '\x1b[0m';

export function printLevel0(r: ScenarioResult, outDir: string): void {
    const failed = r.checks.filter((c) => !c.pass);
    const n = r.checks.length;
    const bad = failed.length > 0 || !!r.error;
    const tally = failed.length === 0 ? `${n} checks` : `${n - failed.length}/${n} checks`;
    console.log(`${bad ? RED + '✗' + RST : GRN + '✓' + RST} ${r.name.padEnd(18)}` +
                `${tally.padStart(11)}  ${r.seconds.toFixed(1)}s`);
    for (const c of failed) {
        const detail = c.expected !== undefined
            ? `${c.actual ?? '?'}, want ${c.expected}` : c.label;
        console.log(`  ${RED}✗${RST} ${c.id.padEnd(20)} ${detail}     ${outDir}/${r.name}.md#${c.id}`);
    }
    if (r.error) {
        const first = r.error.split('\n')[0];
        console.log(`  ${RED}✗${RST} ${'threw'.padEnd(20)} ${first}     ${outDir}/${r.name}.md`);
    }
}

export function writeReport(outDir: string, results: ScenarioResult[]): void {
    mkdirSync(outDir, { recursive: true });
    for (const r of results) {
        const lines: string[] = [`# ${r.name}`, '', `${r.seconds.toFixed(1)}s`, ''];
        if (r.error) lines.push('## threw', '', '```', r.error, '```', '');
        for (const c of r.checks) {
            lines.push(`## ${c.pass ? 'PASS' : 'FAIL'} ${c.id} {#${c.id}}`, '', c.label, '');
            if (c.expected !== undefined) lines.push(`- expected: \`${c.expected}\``);
            if (c.actual !== undefined) lines.push(`- actual: \`${c.actual}\``);
            if (c.frame !== undefined) lines.push(`- frame: ${c.frame}`);
            lines.push('');
        }
        if (Object.keys(r.notes).length) {
            lines.push('## notes', '', '```json', JSON.stringify(r.notes, null, 2), '```', '');
        }
        writeFileSync(join(outDir, `${r.name}.md`), lines.join('\n'));
    }
    writeFileSync(join(outDir, 'run.json'), JSON.stringify(results, null, 2));
    const total  = results.reduce((a, r) => a + r.checks.length, 0);
    const failed = results.reduce((a, r) => a + r.checks.filter((c) => !c.pass).length, 0);
    writeFileSync(join(outDir, 'run.md'),
        `# device run\n\n${results.length} scenarios · ${total} checks · ${failed} failed\n`);
}
