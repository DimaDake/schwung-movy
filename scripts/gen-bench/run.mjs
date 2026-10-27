/* Runs the generator bench against real Gemini models: the SHIPPED context,
 * prompt, request and validator (dist/esm/ai), so it measures what the Move
 * would send. Replies are cached by (model, request body, run) so re-scoring
 * and repeat reports cost no quota. Never calls a Pro model.
 *
 *   GEMINI_KEY_FILE=<path> node scripts/gen-bench/run.mjs --models a,b \
 *       [--cases <substring>] [--level BALANCED] [--repeat 1] --label <name>
 *   GEN_STYLE='{"units":"ticks"}' turns one prompt switch (prompt.ts PromptStyle).
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { renderReport } from './report.mjs';
import { scoreReply } from './score.mjs';

const ROOT = new URL('../../.gen-data/', import.meta.url).pathname;
const PLANS = new URL('../../plans/', import.meta.url).pathname;

export function assertModelAllowed(name) {
    if (/pro/i.test(name)) throw new Error(`refusing ${name}: Pro models are off limits`);
}

export function cacheKey(model, body, run) {
    return createHash('sha256').update(`${model}\n${run}\n${body}`).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 4500;            // ~13 requests a minute per model: under the free tier's 15 RPM
const TIMEOUT_MS = 60_000;      // the Move's curl timeout

async function call(req, model, run) {
    const key = cacheKey(model, req.body, run);
    const file = ROOT + 'cache/' + key + '.json';
    if (existsSync(file)) return { ...JSON.parse(readFileSync(file, 'utf8')), cached: true };
    const headers = Object.fromEntries(req.headers.map((h) => [h.slice(0, h.indexOf(':')), h.slice(h.indexOf(':') + 1).trim()]));
    let out;
    for (let attempt = 0; attempt < 3; attempt++) {
        const t0 = Date.now();
        try {
            const r = await fetch(req.url, { method: 'POST', headers, body: req.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
            out = { http: r.status, curlExit: 0, body: await r.text(), ms: Date.now() - t0, attempts: attempt + 1 };
        } catch {
            out = { http: 0, curlExit: 28, body: '', ms: Date.now() - t0, attempts: attempt + 1 };
        }
        if (out.http !== 429 && out.http !== 503) break;
        await sleep(attempt ? 20_000 : 8_000);
    }
    /* Only answers are cached: a busy hour must not stick to the next run. */
    if (out.http === 200) writeFileSync(file, JSON.stringify(out));
    return out;
}

/* A model that is down (503 or no answer) would cost a minute per case:
 * after this many failures in a row its remaining cases are recorded as
 * failed without asking. */
const GIVE_UP_AFTER = 5;

async function runModel(ai, model, cases, opt, key, sink) {
    let failsInRow = 0;
    for (let run = 0; run < opt.repeat; run++) {
        for (const c of cases) {
            if (failsInRow >= GIVE_UP_AFTER) {
                sink({ id: c.id, model, kind: c.kind, genre: c.genre, run, ok: false, status: 'SKIPPED (model down)', ms: 0, cached: true });
                continue;
            }
            const len = 32;
            const units = opt.style.units ?? ai.DEFAULT_STYLE?.units ?? 'ticks';
            const prompt = ai.buildPrompt(c.task, ai.buildContext({ ...c.set, units }), { len, drum: c.drum, level: opt.level, style: opt.style });
            const req = ai.buildRequest({ model, key, models: [model] }, prompt, ai.LEVEL_TEMPERATURE?.[opt.level]);
            const res = await call(req, model, run);
            const status = ai.classifyStatus(res.http, res.curlExit);
            const row = { id: c.id, model, kind: c.kind, genre: c.genre, run, ok: status === 'ok', status, ms: res.ms, cached: !!res.cached };
            if (row.ok) {
                const text = ai.extractText(res.body) ?? '';
                const kit = [...new Set(c.input.map((n) => n.pitch))];
                const options = ai.validateOptions(text, { task: c.task, len, drum: c.drum, original: c.input,
                    kitPads: c.drum ? kit : [], units: prompt.units });
                Object.assign(row, { options: options.length },
                    scoreReply(options, { set: c.set, input: c.input, reference: c.reference, a: c.a, len, drum: c.drum, task: c.task }));
                const usage = JSON.parse(res.body).usageMetadata;
                row.tokens = usage ? usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0) : null;
            }
            failsInRow = row.ok ? 0 : failsInRow + 1;
            sink(row);
            console.log(`${model} ${c.id} run${run}: ${status} ${res.ms}ms${row.cached ? ' (cached)' : ''}`
                + (row.ok ? ` align ${row.alignment?.toFixed(2) ?? '-'} gate ${row.gatePassed ? 'pass' : 'FAIL ' + row.perOption.map((p) => p.reasons.join('+') || 'ok').join('|')}` : ''));
            if (!row.cached) await sleep(GAP_MS);
        }
    }
}

async function main() {
    const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => {
        const [k, ...v] = a.trim().split(' ');
        return [k, v.join(' ')];
    }));
    const models = (args.models || '').split(',').filter(Boolean);
    models.forEach(assertModelAllowed);
    const label = args.label || 'run';
    /* GEN_STYLE='{"units":"ticks"}' etc.: one prompt switch off, for an A/B. */
    const opt = { level: args.level || 'BALANCED', repeat: Number(args.repeat || 1), style: JSON.parse(process.env.GEN_STYLE || '{}') };
    const key = readFileSync(process.env.GEMINI_KEY_FILE, 'utf8').trim();
    const ai = await import('../../dist/esm/ai/index.js');
    const cases = readdirSync(ROOT + 'cases').sort().filter((f) => !args.cases || f.includes(args.cases))
        .map((f) => JSON.parse(readFileSync(ROOT + 'cases/' + f, 'utf8')));
    mkdirSync(ROOT + 'cache', { recursive: true });
    mkdirSync(ROOT + 'results', { recursive: true });
    const out = ROOT + `results/${label}.jsonl`;
    rmSync(out, { force: true });
    const rows = [];
    const sink = (r) => { rows.push(r); appendFileSync(out, JSON.stringify(r) + '\n'); };
    await Promise.all(models.map((m) => runModel(ai, m, cases, opt, key, sink)));
    const missing = existsSync(ROOT + 'src/missing.json') ? JSON.parse(readFileSync(ROOT + 'src/missing.json', 'utf8')) : [];
    const md = renderReport(label, rows, { missing, level: opt.level, repeat: opt.repeat, cases: cases.length });
    const date = new Date().toISOString().slice(0, 10);
    writeFileSync(PLANS + `gen-bench-results-${date}-${label}.md`, md);
    console.log(md);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
