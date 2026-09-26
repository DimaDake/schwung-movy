import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attempt, ScenarioResult } from './types.js';

/* Three levels, one rule: EVIDENCE IS CAPTURED ALWAYS, PRINTED NEVER.
 *
 * Level 0 (stdout) is the only thing read by default, so a green sweep stays a
 * handful of lines and a failure's FIRST line is diagnostic on its own. Having
 * to re-run a device suite to find out what broke — plus the ssh log greps that
 * follow — is the cost this design exists to remove.
 *
 * A retried scenario is the one exception to "printed never": a flake that is
 * not on screen is a flake nobody fixes. It gets one extra line naming what
 * failed the first time, and no more — the rest is in the artifact. */
const GRN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', DIM = '\x1b[2m', RST = '\x1b[0m';

function detailOf(c: { expected?: string; actual?: string; label: string }): string {
    return c.expected !== undefined ? `${c.actual ?? '?'}, want ${c.expected}` : c.label;
}

export function printLevel0(r: ScenarioResult, outDir: string): void {
    const failed = r.checks.filter((c) => !c.pass);
    const n = r.checks.length;
    const tally = failed.length === 0 ? `${n} checks` : `${n - failed.length}/${n} checks`;
    const mark = r.status === 'fail' ? RED + '✗' + RST
        : r.status === 'flaky' ? YEL + '⚠' + RST : GRN + '✓' + RST;
    console.log(`${mark} ${r.name.padEnd(18)}${tally.padStart(11)}  ${r.seconds.toFixed(1)}s` +
                (r.status === 'flaky' ? `  ${YEL}FLAKY${RST} passed on attempt ${r.attempts.length}` : '') +
                (r.status === 'fail' && r.knownFlaky
                    ? `  ${YEL}KNOWN FLAKY — not gating${RST} (${r.knownFlaky})` : ''));
    for (const c of failed) {
        console.log(`  ${RED}✗${RST} ${c.id.padEnd(20)} ${detailOf(c)}     ${outDir}/${r.name}.md#${c.id}`);
    }
    if (r.error) {
        console.log(`  ${RED}✗${RST} ${'threw'.padEnd(20)} ${r.error.split('\n')[0]}     ${outDir}/${r.name}.md`);
    }
    /* A wait that only just landed. Printed on a PASSING scenario too — that
     * is the whole point of it: the warning has to arrive before the red. */
    const near = r.notes.waits_near_budget;
    if (Array.isArray(near) && near.length) {
        const w = near[0] as { what: string; spent: number; within: number };
        const more = near.length > 1 ? ` (+${near.length - 1} more)` : '';
        console.log(`  ${YEL}!${RST} ${DIM}wait near budget: ${w.what} took ` +
                    `${w.spent}/${w.within} frames${more}${RST}`);
    }
    /* What the retry hid. Without this the only difference between a clean run
     * and a race is a word at the end of the line. */
    for (const a of r.attempts) {
        if (!a.kind) continue;
        if (a === r.attempts[r.attempts.length - 1]) continue;
        const why = a.error ? a.error.split('\n')[0]
            : a.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${detailOf(c)}`).join('; ');
        console.log(`  ${DIM}attempt ${a.n} failed (${a.kind}): ${why}${RST}`);
    }
}

export function printSummary(results: ScenarioResult[], failed: number, outDir: string): void {
    const total = results.reduce((a, r) => a + r.checks.length, 0);
    const flaky = results.filter((r) => r.status === 'flaky');
    const infra = results.filter((r) => r.status !== 'flaky'
        && r.attempts.some((a) => a.kind === 'infra'));
    const parts = [`${results.length} scenarios`, `${total} checks`, `${failed} failed`];
    if (flaky.length) parts.push(`${YEL}${flaky.length} FLAKY${RST} (${flaky.map((r) => r.name).join(', ')})`);
    const known = results.filter((r) => r.status === 'fail' && r.knownFlaky);
    if (known.length) parts.push(`${YEL}${known.length} KNOWN-FLAKY red, not gating${RST} (${known.map((r) => r.name).join(', ')})`);
    if (infra.length) parts.push(`${infra.length} infra-retried (${infra.map((r) => r.name).join(', ')})`);
    console.log(`\n${parts.join(' · ')}   → ${outDir}/run.md`);
}

function attemptSection(a: Attempt): string[] {
    const lines = [`## attempt ${a.n} — ${a.kind ?? 'passed'} (${a.seconds.toFixed(1)}s)`, ''];
    if (a.error) lines.push('```', a.error, '```', '');
    for (const c of a.checks.filter((x) => !x.pass)) {
        lines.push(`- FAIL \`${c.id}\` — ${c.label}` +
            (c.expected !== undefined ? ` (actual \`${c.actual ?? '?'}\`, expected \`${c.expected}\`)` : ''));
    }
    lines.push('');
    return lines;
}

export function writeReport(outDir: string, results: ScenarioResult[]): void {
    mkdirSync(outDir, { recursive: true });
    for (const r of results) {
        const lines: string[] = [`# ${r.name}`, '', `${r.status.toUpperCase()} · ${r.seconds.toFixed(1)}s`, ''];
        if (r.knownFlaky) lines.push(`KNOWN FLAKY — does not gate the tier: ${r.knownFlaky}`, '');
        if (r.status === 'flaky') {
            lines.push(`FLAKY: failed on attempt ${r.attempts[0].n}, passed on attempt ${r.attempts.length}.`, '');
        }
        if (r.error) lines.push('## threw', '', '```', r.error, '```', '');
        for (const c of r.checks) {
            lines.push(`## ${c.pass ? 'PASS' : 'FAIL'} ${c.id} {#${c.id}}`, '', c.label, '');
            if (c.expected !== undefined) lines.push(`- expected: \`${c.expected}\``);
            if (c.actual !== undefined) lines.push(`- actual: \`${c.actual}\``);
            if (c.frame !== undefined) lines.push(`- frame: ${c.frame}`);
            lines.push('');
        }
        /* Only the ones that failed: the last attempt IS the body above. */
        for (const a of r.attempts) if (a.kind) lines.push(...attemptSection(a));
        if (Object.keys(r.notes).length) {
            lines.push('## notes', '', '```json', JSON.stringify(r.notes, null, 2), '```', '');
        }
        writeFileSync(join(outDir, `${r.name}.md`), lines.join('\n'));
    }
    writeFileSync(join(outDir, 'run.json'), JSON.stringify(results, null, 2));
    const total  = results.reduce((a, r) => a + r.checks.length, 0);
    const failed = results.reduce((a, r) => a + r.checks.filter((c) => !c.pass).length, 0);
    const flaky  = results.filter((r) => r.status === 'flaky').map((r) => r.name);
    writeFileSync(join(outDir, 'run.md'),
        `# device run\n\n${results.length} scenarios · ${total} checks · ${failed} failed` +
        (flaky.length ? ` · ${flaky.length} flaky (${flaky.join(', ')})` : '') + '\n');
}
