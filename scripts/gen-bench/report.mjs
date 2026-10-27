/* The bench report: one table per model and task kind, numbers and model
 * names only — no notes, no case ids, no song names, nothing from a dataset. */

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '-');
const f2 = (v) => (v === null || v === undefined || Number.isNaN(v) ? '-' : v.toFixed(2));
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

function summarise(rows) {
    const ok = rows.filter((r) => r.ok);
    const opt = (k, i) => mean(ok.map((r) => r.perOption?.[i]?.[k]).filter((v) => typeof v === 'number'));
    return {
        n: rows.length,
        fail: pct(rows.length - ok.length, rows.length),
        alignment: mean(ok.map((r) => r.alignment).filter((v) => typeof v === 'number')),
        gate: pct(ok.filter((r) => r.gatePassed).length, ok.length),
        fit: mean(ok.flatMap((r) => r.perOption.map((p) => p.fit)).filter((v) => typeof v === 'number')),
        groove: mean(ok.flatMap((r) => r.perOption.map((p) => p.groove)).filter((v) => typeof v === 'number')),
        idea: [0, 1, 2].map((i) => f2(opt('ideaKept', i))).join(' / '),
        pairDiff: mean(ok.map((r) => r.minPairDiff)),
        ladder: pct(ok.filter((r) => r.ladderOrdered).length, ok.length),
        p50: quantile(rows.filter((r) => !r.cached).map((r) => r.ms), 0.5),
        p90: quantile(rows.filter((r) => !r.cached).map((r) => r.ms), 0.9),
    };
}

export function renderReport(label, rows, meta = {}) {
    const models = [...new Set(rows.map((r) => r.model))];
    const kinds = ['all', ...new Set(rows.map((r) => r.kind))];
    const lines = [`# Generator bench: ${label}`, '',
        `Level ${meta.level ?? '-'}, ${meta.cases ?? '-'} cases, ${meta.repeat ?? 1} run(s) each. `
            + `Missing sources: ${(meta.missing ?? []).join(', ') || 'none'}.`, '',
        '**Alignment** (headline) = best option\'s recovery of the clean part (messy quantize) or alignment with '
            + 'the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. '
            + 'Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.', ''];
    for (const kind of kinds) {
        lines.push(`## ${kind}`, '', '| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |',
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
        for (const m of models) {
            const s = summarise(rows.filter((r) => r.model === m && (kind === 'all' || r.kind === kind)));
            lines.push(`| ${m} | ${s.n} | ${s.fail} | ${f2(s.alignment)} | ${s.gate} | ${f2(s.fit)} | ${f2(s.groove)} | ${s.idea} | ${f2(s.pairDiff)} | ${s.ladder} | ${s.p50 ?? '-'} | ${s.p90 ?? '-'} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
