#!/usr/bin/env node
/* dump-movy-layout.mjs — derive movy's parameter-page layout for every module
 * captured in docs/module-dump/device-dump.json.
 *
 * Boots the REAL model (dist/esm) per module with the captured device params
 * served through the browser-test env stubs, so the output is exactly what
 * movy computes on device: banks/pages, labels, on-screen short names, knob
 * render styles, ranges, steps, enum options, envelope/LFO groupings,
 * automatable flags — plus derived increment semantics and native↔movy diffs.
 *
 * Run from movy root (dist/esm must be fresh):
 *   npm run build:browser && node scripts/dump-movy-layout.mjs
 *
 * Output: docs/module-dump/modules/<category>--<id>.json + SUMMARY.md
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
    MOVY, DUMP_DIR, loadDump, createDumpBoot, serializePages, expandLayoutKeys,
} from '../browser-test/dump-boot.mjs';

/* Increment constants — read from the source of truth so they can't drift. */
const constantsSrc = readFileSync(join(MOVY, 'src', 'model', 'constants.ts'), 'utf8');
const constOf = (name) => {
    const m = constantsSrc.match(new RegExp(`${name}\\s*=\\s*([\\d.]+)`));
    if (!m) throw new Error(`cannot find ${name} in src/model/constants.ts`);
    return parseFloat(m[1]);
};
const ARC_DELTA_SCALE = constOf('ARC_DELTA_SCALE');
const ENUM_DELTA_DIV  = constOf('ENUM_DELTA_DIV');

const dump = loadDump();
const { bootFromDumpEntry } = await createDumpBoot(dump);

/* ── helpers ─────────────────────────────────────────────────────────────── */

function incrementInfo(p) {
    if (!p) return null;
    if (p.type === 'file') return { kind: 'file-browse' };
    if (p.type === 'enum' || p.renderStyle === 'preset') {
        const steps = p.options ? p.options.length : (p.max - p.min + 1);
        return { kind: 'enum', detentsPerStep: ENUM_DELTA_DIV, steps };
    }
    const perDetent = p.step * (p.renderStyle === 'arc' ? ARC_DELTA_SCALE : 1);
    return {
        kind: p.type,
        perDetent,
        detentsFullSweep: perDetent > 0 ? Math.round((p.max - p.min) / perDetent) : null,
    };
}

/* ── per-module processing ───────────────────────────────────────────────── */

mkdirSync(join(DUMP_DIR, 'modules'), { recursive: true });
rmSync(join(DUMP_DIR, 'modules'), { recursive: true, force: true });
mkdirSync(join(DUMP_DIR, 'modules'), { recursive: true });

const summaryRows = { midi_fx: [], sound_generator: [], audio_fx: [] };
const anomalies = [];

for (const entry of dump.modules) {
    const m = bootFromDumpEntry(entry);
    const layout = m.dumpLayout();
    const pageCount = m.getBankCount();

    /* Per-page view (what the user actually sees, incl. envelope/LFO groups
     * and the deduped 5-char on-screen names). */
    const pages = serializePages(m).map(p => ({
        name: p.name,
        envelopeLines: p.envelopeLines,
        lfoViz: p.lfoVizCount > 0,
        rows: p.rows,
    }));

    /* Native param table: chain_params metadata + captured default value. */
    const cp = Array.isArray(entry.chain_params) ? entry.chain_params : [];
    const nativeParams = cp.map(p => ({
        key: p.key, name: p.name ?? null, type: p.type ?? null,
        min: p.min ?? null, max: p.max ?? null, step: p.step ?? null,
        options: p.options ?? null,
        default: entry.params[p.key] ?? null,
    }));

    /* Diffs */
    const shownKeys = expandLayoutKeys(layout);
    const hiddenParams = nativeParams.filter(p => p.key && !shownKeys.has(p.key)).map(p => p.key);
    const cpKeys = new Set(cp.map(p => p.key));
    const noMetadata = layout.params
        .filter(p => p && p.type !== 'file' && !cpKeys.has(p.key))
        .map(p => p.key);

    const warnings = [];
    if (entry.status !== 'ok') warnings.push(`device status: ${entry.status}`);
    if (!entry.ui_hierarchy && !layout.hasConfig && cp.length > 0)
        warnings.push('has chain_params but no ui_hierarchy and no movy config');
    if (layout.params.filter(Boolean).length === 0 && (cp.length > 0 || entry.ui_hierarchy))
        warnings.push('movy shows NO params although the module exposes some');
    if (hiddenParams.length > 0)
        warnings.push(`${hiddenParams.length} chain_params not reachable in movy: ${hiddenParams.slice(0, 12).join(', ')}${hiddenParams.length > 12 ? ', …' : ''}`);
    /* Params movy had to guess metadata for (defaults 0..1 float) */
    if (!layout.hasConfig && noMetadata.length > 0)
        warnings.push(`${noMetadata.length} shown params lack chain_params metadata (movy guesses type/range): ${noMetadata.slice(0, 12).join(', ')}${noMetadata.length > 12 ? ', …' : ''}`);
    /* On-screen name collisions after 5-char truncation (pre-dedup) */
    for (const pgv of pages) {
        const names = pgv.rows.flat().filter(Boolean).map(p => p.shortName);
        const clipped = names.filter(n => /\d$/.test(n));
        const dups = names.filter((n, i) => names.indexOf(n) !== i);
        if (dups.length > 0)
            warnings.push(`page "${pgv.name}": duplicate on-screen names ${[...new Set(dups)].join(', ')}`);
        void clipped;
    }

    const out = {
        id: entry.id,
        name: entry.module_json?.name ?? entry.id,
        version: entry.module_json?.version ?? null,
        author: entry.module_json?.author ?? null,
        category: entry.category,
        status: entry.status,
        load_ms: entry.load_ms,
        dsp_size: entry.dsp_size,
        capabilities: entry.module_json?.capabilities ?? null,
        presets: entry.presets ? {
            count: entry.presets.count,
            sample: (entry.presets.names ?? []).slice(0, 10),
        } : null,
        native: {
            hierarchy_levels: entry.ui_hierarchy ? Object.keys(entry.ui_hierarchy.levels ?? {}) : [],
            params: nativeParams,
        },
        movy: {
            hasConfig: layout.hasConfig,
            usesMovyConfigFile: !!entry.movy_config,
            drum: layout.drum,
            banks: layout.banks,
            pages,
            params: layout.params.map(p => p && { ...p, increment: incrementInfo(p) }),
        },
        analysis: { hiddenParams, noMetadata, warnings },
    };

    writeFileSync(
        join(DUMP_DIR, 'modules', `${entry.category}--${entry.id}.json`),
        JSON.stringify(out, null, 1) + '\n');

    summaryRows[entry.category].push({
        id: entry.id,
        name: out.name,
        version: out.version ?? '—',
        status: entry.status,
        cfg: layout.hasConfig ? (entry.movy_config ? 'file' : 'bundled') : '—',
        drum: layout.drum ? `${layout.drum.padCount} pads` : '—',
        pages: pageCount,
        shown: layout.params.filter(Boolean).length,
        native: cp.length,
        hidden: hiddenParams.length,
        presets: entry.presets?.count ?? 0,
    });
    if (warnings.length > 0) anomalies.push({ id: entry.id, category: entry.category, warnings });
}

/* ── SUMMARY.md ──────────────────────────────────────────────────────────── */

const CAT_TITLE = { midi_fx: 'MIDI FX', sound_generator: 'Sound generators', audio_fx: 'Audio FX' };
let md = `# Module inventory summary

Generated ${dump.generated_at} from ${dump.modules.length} installed modules
(schwung ${dump.schwung_release?.version ?? '?'}). Raw capture:
[device-dump.json](device-dump.json); per-module detail in [modules/](modules/).

Columns — **cfg**: movy custom layout (bundled = src/modules/*.json, file =
on-device movy_config.json); **shown**: knob slots movy exposes; **native**:
chain_params entries; **hidden**: native params not reachable from movy
(pad-alias-expanded); **pages**: movy knob pages.

`;
for (const [cat, rows] of Object.entries(summaryRows)) {
    if (rows.length === 0) continue;
    md += `## ${CAT_TITLE[cat]} (${rows.length})\n\n`;
    md += `| module | version | status | cfg | drum | pages | shown | native | hidden | presets |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|\n`;
    for (const r of rows) {
        md += `| [${r.id}](modules/${cat}--${r.id}.json) | ${r.version} | ${r.status} | ${r.cfg} | ${r.drum} | ${r.pages} | ${r.shown} | ${r.native} | ${r.hidden} | ${r.presets} |\n`;
    }
    md += `\n`;
}
md += `## Anomalies\n\n`;
if (anomalies.length === 0) md += `None.\n`;
for (const a of anomalies) {
    md += `- **${a.id}** (${a.category})\n`;
    for (const w of a.warnings) md += `  - ${w}\n`;
}
writeFileSync(join(DUMP_DIR, 'SUMMARY.md'), md);

console.log(`Wrote ${dump.modules.length} module layouts + SUMMARY.md to ${DUMP_DIR}`);
const warnCount = anomalies.reduce((n, a) => n + a.warnings.length, 0);
console.log(`${anomalies.length} modules with anomalies (${warnCount} warnings)`);
