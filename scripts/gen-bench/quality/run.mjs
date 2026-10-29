/* The generator quality bench (plans/2026-10-29-generator-quality-metrics.md):
 * the knob sweep, the knob-space map, the map knobs and the piece, beside the older bench's
 * headline numbers, so a change that lifts one is seen against the rest.
 *
 *   npm run build:browser && node scripts/gen-bench/quality/run.mjs --label base [--compare other] [--cases sub] [--pieces 12]
 *
 * Writes .gen-data/quality/<label>.json, plans/gen-quality-<label>.md and the
 * pieces as MIDI under .gen-data/pieces/<label>/ for listening. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { caseInput, runCase, summary } from '../algo.mjs';
import { createInput, createStats } from '../create.mjs';
import { doubleInput, doubleStats } from '../double.mjs';
import { judgePiece, pieceMidi } from './piece-score.mjs';
import { buildPiece } from './piece.mjs';
import { report } from './report.mjs';
import { mapPreset, mapSummary } from './maps.mjs';
import { phrasePreset, phraseSummary } from './phrase.mjs';
import { spacePreset, spaceSummary } from './space.mjs';
import { sweepPreset, sweepSummary } from './sweep.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const PLANS = new URL('../../../plans/', import.meta.url).pathname;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function requests(cases) {
    const out = [];
    for (const c of cases) {
        out.push(caseInput(c, 'BALANCED'));
        const d = doubleInput(c, 'BALANCED');
        if (d) out.push(d);
        const k = createInput(c, 'BALANCED', 1);
        out.push(c.drum ? { ...k, kit: k.kit.length ? k.kit : [36, 38, 42], pad: (k.kit[0] ?? 36) } : k);
    }
    return out;
}

function oldMetrics(G, cases) {
    const rows = cases.map((c) => runCase(G, c, 'BALANCED', 3));
    const six = cases.filter((c) => c.task === 'variation').map((c) => runCase(G, c, 'BALANCED', 6));
    const s = summary(rows);
    const vops = rows.filter((r) => r.kind === 'variation').flatMap((r) => r.perOption);
    return { alignment: s.all, gate: s.gate, playedGate: s.played, varSixGate: six.filter((r) => r.gatePassed).length / Math.max(1, six.length),
        varNovelty: mean(vops.map((o) => 1 - o.ideaKept)), varCoherence: mean(vops.map((o) => o.fit).filter((v) => v !== null && v !== undefined)),
        double: doubleStats(G, cases, 'BALANCED'), create: createStats(G, cases) };
}

async function main() {
    const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => {
        const [k, ...v] = a.trim().split(' ');
        return [k, v.join(' ')];
    }));
    const label = args.label || 'quality';
    const G = await import('../../../dist/esm/gen/index.js');
    const ai = await import('../../../dist/esm/ai/index.js');
    const cases = readdirSync(DATA + 'cases').sort().filter((f) => !args.cases || f.includes(args.cases))
        .map((f) => JSON.parse(readFileSync(DATA + 'cases/' + f, 'utf8')));
    const t0 = Date.now();
    const sw = [], sp = [], mp = [], ph = [];
    for (const input of requests(cases)) {
        G.forgetOptions();
        const ctx = G.prepare(input);
        for (const p of G.PRESETS.filter((x) => G.serves(x, ctx))) {
            sw.push(sweepPreset(G, ctx, p));
            sp.push(spacePreset(G, ctx, p, ctx.seed));
            mp.push(mapPreset(G, ctx, p));
            ph.push(phrasePreset(G, ctx, p));
        }
    }
    const t1 = Date.now();
    const n = Number(args.pieces || 12);
    const pieces = [];
    const dir = DATA + `pieces/${label}/`;
    mkdirSync(dir, { recursive: true });
    for (const motif of [false, true]) {
        for (let s = 0; s < n; s++) {
            const piece = buildPiece(G, s, motif);
            pieces.push(judgePiece(G, ai, piece));
            writeFileSync(dir + `${motif ? 'motif' : 'scratch'}-${s}.mid`, pieceMidi(piece));
        }
    }
    const t2 = Date.now();
    const old = oldMetrics(G, cases);
    const res = { label, cases: cases.length, ms: { knobs: t1 - t0, pieces: t2 - t1, old: Date.now() - t2 },
        sweep: sweepSummary(sw), space: spaceSummary(sp), maps: mapSummary(mp), phrase: phraseSummary(ph), pieces, old };
    mkdirSync(DATA + 'quality', { recursive: true });
    writeFileSync(DATA + `quality/${label}.json`, JSON.stringify(res));
    const prev = args.compare && existsSync(DATA + `quality/${args.compare}.json`) ? JSON.parse(readFileSync(DATA + `quality/${args.compare}.json`, 'utf8')) : null;
    const md = report(res, prev);
    if (!args.cases) writeFileSync(PLANS + `gen-quality-${label}.md`, md);
    console.log(md);
}

await main();
