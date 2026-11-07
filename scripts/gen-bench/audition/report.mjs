/* "Act on ratings" (plans/2026-11-07-gen-audition-design.md, the fix loop).
 *
 *   1. ArtifactData list ratings (all pages) -> .gen-data/audition/ratings.json
 *      (an array of the documents, { id, data } or bare data)
 *   2. node scripts/gen-bench/audition/report.mjs
 *
 * Writes .gen-data/audition/report.md (per generator, worst first) and
 * first.json (the cases rated bad, for export.mjs --first). */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { firstList, summarise } from './summary.mjs';

const DIR = new URL('../../../.gen-data/audition/', import.meta.url).pathname;

/** Every case of every export kept on disk (ratings may name older builds). */
export function allCases() {
    const out = [];
    for (const d of readdirSync(DIR)) {
        if (d === 'site' || !statSync(DIR + d).isDirectory()) continue;
        for (const f of readdirSync(DIR + d)) if (/^cases-\d+\.json$/.test(f)) out.push(...JSON.parse(readFileSync(DIR + d + '/' + f, 'utf8')));
    }
    return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    if (!existsSync(DIR + 'ratings.json')) { console.error('no ratings: dump the artifact\'s "ratings" collection to .gen-data/audition/ratings.json'); process.exit(1); }
    const ratings = JSON.parse(readFileSync(DIR + 'ratings.json', 'utf8'));
    const cases = allCases();
    const { byGenerator, blind } = summarise(ratings, cases);
    const pct = (a, n) => (n ? `${Math.round((100 * a) / n)}%` : '–');
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
    const lines = [`# Audition ratings: ${ratings.length} ratings`, '',
        `Blind: real parts kept ${pct(blind.realKeep, blind.real)} of ${blind.real}, generated kept ${pct(blind.genKeep, blind.gen)} of ${blind.gen}.`, '',
        '| generator | rated | keep | meh | bad | top reasons | marks | bench ok, ear bad | bench bad, ear keep |', '|---|---|---|---|---|---|---|---|---|',
        ...byGenerator.map((g) => `| ${g.generator} | ${g.n} | ${pct(g.keep, g.n)} | ${pct(g.meh, g.n)} | ${pct(g.bad, g.n)} | ${top(g.reasons)} | ${g.marks.length} | ${g.earVsBench.benchOkUserBad} | ${g.earVsBench.benchBadUserKeep} |`),
        '', '## Marks (read the rolls here)', '',
        ...byGenerator.flatMap((g) => g.marks.map((m) => `- ${g.generator}: case ${m.caseId}${m.option !== null && m.option !== undefined ? ` option ${m.option + 1}` : ''}, bar ${m.bar} beat ${m.beat}`))];
    writeFileSync(DIR + 'report.md', lines.join('\n') + '\n');
    const first = firstList(ratings, cases);
    writeFileSync(DIR + 'first.json', JSON.stringify(first));
    console.log(`${DIR}report.md: ${byGenerator.length} generators; first.json: ${first.length} cases to re-listen after a fix`);
}
