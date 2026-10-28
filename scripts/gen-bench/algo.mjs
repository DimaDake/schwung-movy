/* The algorithmic generators on the bench (plans/2026-10-27-algorithmic-
 * generators-design.md §8): the same cases and scorer as the model runs, the
 * shipped engine (dist/esm/gen), no network. Compared case by case with the
 * cached reference run `default-x3` (gemini-3.1-flash-lite, BALANCED, three
 * runs), on a fixed dev / holdout split so tuning on one half is judged on
 * the other.
 *
 *   npm run build:browser && node scripts/gen-bench/algo.mjs [--label algo] [--cases <substring>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scoreReply } from './score.mjs';
import { cachedReplies, DIMS, kindOf, variability } from './variability.mjs';
import { doubleSection } from './double.mjs';
import { createSection } from './create.mjs';

const ROOT = new URL('../../.gen-data/', import.meta.url).pathname;
const PLANS = new URL('../../plans/', import.meta.url).pathname;
const REF = { file: 'default-x3', model: 'gemini-3.1-flash-lite' };
const LEN = 32;   // the model runs asked every case at 32 steps (run.mjs)

/** Dev or holdout: alternating by sorted id within each source, so both
 *  halves hold every source and kind. Fixed: never chosen by result. */
export function half(cases) {
    const by = new Map();
    for (const c of [...cases].sort((x, y) => (x.id < y.id ? -1 : 1))) {
        const g = c.id.split('-')[0] + ':' + c.kind;
        if (!by.has(g)) by.set(g, []);
        by.get(g).push(c.id);
    }
    const out = new Map();
    for (const list of by.values()) list.forEach((id, i) => out.set(id, i % 2 === 0 ? 'dev' : 'holdout'));
    return out;
}

/* Smart Quantize works at the clip's own length on the device (job-target.ts);
 * a Variation at the length the model runs asked for. */
export const caseLen = (c) => (c.task === 'quantize'
    ? c.set.tracks.find((t) => t.index === c.set.target.track)?.clips.find((k) => k.slot === c.set.target.slot)?.len ?? LEN : LEN);

export function caseInput(c, level) {
    return { task: c.task, level, tracks: c.set.tracks, target: c.set.target, source: c.set.source, len: caseLen(c),
        scale: [1, 1], drum: c.drum, kit: c.drum ? [...new Set(c.input.map((n) => n.pitch))] : [], root: c.set.root, mode: c.set.mode };
}

export function runCase(gen, c, level, count) {
    const { picks, dropped } = gen.generateAll(caseInput(c, level), count);
    const options = picks.map((p) => p.notes);
    const s = scoreReply(options, { set: c.set, input: c.input, reference: c.reference, a: c.a, len: caseLen(c), drum: c.drum,
        task: c.task, expected: count });
    return { id: c.id, kind: c.kind, options: options.length, presets: picks.map((p) => p.preset.id), dropped, notes: options, ...s };
}

function refRows() {
    const f = ROOT + `results/${REF.file}.jsonl`;
    if (!existsSync(f)) return new Map();
    const by = new Map();
    for (const r of readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l))) {
        if (r.model !== REF.model || !r.ok) continue;
        if (!by.has(r.id)) by.set(r.id, []);
        by.get(r.id).push(r);
    }
    return by;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f2 = (v) => (v === null || v === undefined ? '-' : v.toFixed(2));
const pc = (v) => (v === null ? '-' : Math.round(v * 100) + '%');

export function summary(rows) {
    const al = (k) => mean(rows.filter((r) => !k || r.kind === k).map((r) => r.alignment).filter((v) => v !== null && v !== undefined));
    const gate = (k) => { const x = rows.filter((r) => !k || r.kind === k); return x.length ? x.filter((r) => r.gatePassed).length / x.length : null; };
    return { all: al(), quant: al('quantize-messy'), vari: al('variation'), gate: gate(), played: gate('quantize-played') };
}

function line(label, s) {
    return `| ${label} | ${f2(s.all)} | ${f2(s.quant)} | ${f2(s.vari)} | ${pc(s.gate)} | ${pc(s.played)} |`;
}

async function main() {
    const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => {
        const [k, ...v] = a.trim().split(' ');
        return [k, v.join(' ')];
    }));
    const gen = await import('../../dist/esm/gen/index.js');
    const cases = readdirSync(ROOT + 'cases').sort().filter((f) => !args.cases || f.includes(args.cases))
        .map((f) => JSON.parse(readFileSync(ROOT + 'cases/' + f, 'utf8')));
    const halves = half(cases);
    const ref = refRows();
    const t0 = Date.now();
    const runs = {};
    for (const level of ['SAFE', 'BALANCED', 'WILD']) runs[level] = cases.map((c) => runCase(gen, c, level, 3));
    const six = cases.filter((c) => c.task === 'variation').map((c) => runCase(gen, c, 'BALANCED', 6));
    const ms = Date.now() - t0;
    const bal = runs.BALANCED;
    const refSum = (ids) => {
        const rows = [...ref.entries()].filter(([id]) => ids.has(id)).flatMap(([, rs]) => rs);
        return summary(rows);
    };
    const ids = (h) => new Set(cases.filter((c) => !h || halves.get(c.id) === h).map((c) => c.id));
    const out = [`# Generator bench: ${args.label || 'algo'} (algorithmic engine)`, '',
        `${cases.length} cases, three options per request (best of three, as the model runs), ${ms} ms for all runs. `
        + `Reference: \`${REF.file}\` ${REF.model} (cached, not re-run). Dev / holdout: alternate cases per source, fixed.`, '',
        '| run | alignment | quantize recovery | variation | gate | played-drum gate |', '| --- | --- | --- | --- | --- | --- |',
        line('AI reference, all', refSum(ids())), line('algorithmic BALANCED, all', summary(bal)),
        line('AI reference, dev', refSum(ids('dev'))), line('algorithmic, dev', summary(bal.filter((r) => halves.get(r.id) === 'dev'))),
        line('AI reference, holdout', refSum(ids('holdout'))), line('algorithmic, holdout', summary(bal.filter((r) => halves.get(r.id) === 'holdout'))),
        line('algorithmic SAFE', summary(runs.SAFE)), line('algorithmic WILD', summary(runs.WILD)), '',
        `Variation best of six (BALANCED): alignment ${f2(mean(six.map((r) => r.alignment).filter((v) => v !== null)))}, `
        + `gate ${pc(six.filter((r) => r.gatePassed).length / Math.max(1, six.length))}.`, '',
        '## Levels (idea kept per option, closest first; min pair difference)', '', '| level | idea kept 1/2/3 | min pair diff |', '| --- | --- | --- |'];
    for (const [level, rows] of Object.entries(runs)) {
        const ik = [0, 1, 2].map((i) => f2(mean(rows.map((r) => r.perOption[i]?.ideaKept).filter((v) => v !== undefined))));
        out.push(`| ${level} | ${ik.join(' / ')} | ${f2(mean(rows.map((r) => r.minPairDiff)))} |`);
    }
    /* Between the options of one request: the model's replies from the cache
     * (its first three, as the model runs asked), the engine's three and six. */
    const replies = cachedReplies(ROOT, REF.model);
    const vAi = variability(replies);
    const v3 = variability(bal.map((r) => r.notes));
    const v6 = variability(six.map((r) => r.notes));
    const vrow = (name, v) => `| ${name} | ${v.n} | ${DIMS.map((d) => f2(v[d])).join(' | ')} |`;
    const kinds = replies.map((o) => kindOf(o, cases));
    const byKind = (k) => [vrow(`AI, ${k}`, variability(replies.filter((_, i) => kinds[i] === k))),
        vrow(`algorithmic, ${k}`, variability(bal.filter((r) => r.kind === k).map((r) => r.notes)))];
    out.push('', '## Variability between the options of one request', '',
        'Mean over option pairs, then over requests. Rhythm, notes, pitches and harmony are distances 0-1; range and register in '
        + 'semitones; density a share; lengths in steps; velocity in velocity units. Higher = the options differ more.', '',
        `| options | requests | ${DIMS.join(' | ')} |`, `| --- | --- | ${DIMS.map(() => '---').join(' | ')} |`,
        vrow(`AI (${REF.model}, cached)`, vAi), vrow('algorithmic, three', v3), vrow('algorithmic, six (device)', v6),
        ...byKind('variation'), ...byKind('quantize-messy'), ...byKind('quantize-played'),
        '', 'A cached reply is matched to the case whose input its options share the most notes with; one matching none is left out of the per-task rows.');
    /* Novelty without coherence is noise (plans/2026-10-28-generators-learned-
     * style-design.md): how far each option moved from the source, and how
     * well its notes sit on the scene's chords, per task. */
    const allRef = [...ref.values()].flat();
    const crow = (name, rows) => {
        const ops = rows.flatMap((r) => r.perOption);
        return `| ${name} | ${rows.length} | ${f2(mean(ops.map((o) => 1 - o.ideaKept)))} | ${f2(mean(ops.map((o) => o.fit).filter((v) => v !== null && v !== undefined)))} |`;
    };
    out.push('', '## Novelty and coherence', '', 'Novelty: 1 - the source idea kept, per option. Coherence: chord fit of melodic options. '
        + 'Higher novelty is only better at equal coherence.', '', '| options | requests | novelty | coherence |', '| --- | --- | --- | --- |');
    for (const k of ['variation', 'quantize-messy', 'quantize-played']) {
        out.push(crow(`AI, ${k}`, allRef.filter((r) => r.kind === k)), crow(`algorithmic, ${k}`, bal.filter((r) => r.kind === k)));
    }
    out.push(crow('algorithmic, variation six (device)', six));
    out.push(...doubleSection(gen, cases));
    out.push(...createSection(gen, cases));
    out.push('', '## Case by case (BALANCED vs the AI reference mean)', '', '| case | half | kind | AI align | algo align | AI gate | algo gate | presets | failed |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    let w = 0, t = 0, l = 0;
    for (const r of bal) {
        const rr = ref.get(r.id) ?? [];
        const ra = mean(rr.map((x) => x.alignment).filter((v) => v !== null && v !== undefined));
        const rg = rr.length ? rr.filter((x) => x.gatePassed).length / rr.length : null;
        if (ra !== null && r.alignment !== null) { if (r.alignment > ra + 0.03) w++; else if (r.alignment < ra - 0.03) l++; else t++; }
        out.push(`| ${r.id} | ${halves.get(r.id)} | ${r.kind} | ${f2(ra)} | ${f2(r.alignment)} | ${pc(rg)} | ${r.gatePassed ? 'pass' : 'FAIL ' + r.perOption.map((p) => p.reasons.join('+') || 'ok').join('|')} | ${r.presets.join(' ')} | ${r.dropped.length} |`);
    }
    out.splice(14, 0, '', `Alignment case by case against the AI mean (±0.03 = tie): ${w} better, ${t} tied, ${l} worse.`, '');
    /* Design §8: the gate, and whether tuning on the dev half bought anything
     * the holdout half does not see (the edge over the model, half by half). */
    const A = refSum(ids()), B = summary(bal);
    const dv = summary(bal.filter((r) => halves.get(r.id) === 'dev')), ho = summary(bal.filter((r) => halves.get(r.id) === 'holdout'));
    const rd = refSum(ids('dev')), rh = refSum(ids('holdout'));
    const row = (name, a, b, min) => `| ${name} | ${f2(a)} | ${f2(b)} | >= ${f2(min)} | ${b !== null && b >= min - 1e-9 ? 'pass' : '**FAIL**'} |`;
    const pct = (name, a, b, min) => `| ${name} | ${pc(a)} | ${pc(b)} | >= ${pc(min)} | ${b !== null && b >= min - 1e-9 ? 'pass' : '**FAIL**'} |`;
    const edge = (x, y) => (x.all ?? 0) - (y.all ?? 0);
    const gap = edge(dv, rd) - edge(ho, rh);
    out.splice(17, 0, '## Gate (design §8)', '', '| metric | AI | algorithmic | gate | verdict |', '| --- | --- | --- | --- | --- |',
        row('alignment', A.all, B.all, 0.54), row('quantize recovery', A.quant, B.quant, 0.75), row('variation alignment', A.vari, B.vari, 0.33),
        pct('gate', A.gate, B.gate, 0.62), pct('played-drum gate', A.played, B.played, 0.67), '',
        `Overfitting check: the edge over the model is ${f2(edge(dv, rd))} on the dev half and ${f2(edge(ho, rh))} on the holdout half; `
        + `a gap of ${f2(gap)}${Math.abs(gap) > 0.03 ? ' — **larger than the ±0.03 run spread**' : ', within the ±0.03 run spread'}.`, '');
    const md = out.join('\n') + '\n';
    if (!args.cases) writeFileSync(PLANS + `gen-bench-results-2026-10-27-${args.label || 'algo'}.md`, md);
    console.log(md);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
