/* browser-test/dump-boot.mjs — shared replay core for the checked-in device
 * dump (docs/module-dump/device-dump.json).
 *
 * Both the layout generator (scripts/dump-movy-layout.mjs) and the regression
 * suite (browser-test/dump-replay.mjs) boot the REAL model per module through
 * the browser-test env stubs. That boot is the only tricky shared logic
 * (componentKey-prefixed param map, synth_module/name fallback, movy_config
 * host_read_file serving, createModel + reload + 2 ticks); it lives here once.
 */

import { installEnv } from './env.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DUMP_DIR = join(MOVY, 'docs', 'module-dump');
const EXTRA_DIR = join(MOVY, 'browser-test', 'fixtures', 'dump-extra');
const CONTRACT_DIR = join(MOVY, 'browser-test', 'fixtures', 'module-contracts');

function upsertModule(modules, entry) {
    const i = modules.findIndex(m => m.id === entry.id && m.category === entry.category);
    if (i >= 0) modules[i] = entry;
    else modules.push(entry);
}

/* Release-side module.json snapshots keep high-value modules current even when
 * the last full hardware inventory is older. Schwung derives chain_params from
 * these hierarchy definitions, so flattening them here mirrors the host's
 * metadata contract without needing to mutate a user's Set for a fleet dump. */
function entryFromModuleContract(moduleJson) {
    const hierarchy = moduleJson.capabilities?.ui_hierarchy ?? { levels: {} };
    const byKey = new Map();
    for (const level of Object.values(hierarchy.levels ?? {})) {
        for (const param of (level.params ?? [])) {
            if (param && typeof param === 'object' && param.key) byKey.set(param.key, { ...param });
        }
        for (const knob of (level.knobs ?? [])) {
            if (knob && typeof knob === 'object' && knob.key) byKey.set(knob.key, { ...knob });
        }
    }
    const chainParams = [...byKey.values()];
    const values = {};
    for (const p of chainParams) {
        const fallback = p.type === 'enum' ? 0 : (p.min ?? 0);
        values[p.key] = String(p.default ?? fallback);
    }
    const category = moduleJson.component_type === 'sound_generator'
        ? 'sound_generator' : moduleJson.component_type;
    const componentKey = category === 'sound_generator' ? 'synth'
        : category === 'midi_fx' ? 'midi_fx1' : 'fx1';
    return {
        id: moduleJson.id, dir: moduleJson.id, category, component_key: componentKey,
        status: 'ok', load_ms: 0, dsp_size: 0, module_json: moduleJson, movy_config: null,
        ui_hierarchy: hierarchy, chain_params: chainParams,
        presets: { list_param: null, count_param: null, name_param: null, count: 0, names: null },
        params: {
            ...values,
            ui_hierarchy: JSON.stringify(hierarchy),
            chain_params: JSON.stringify(chainParams),
        },
    };
}

/* Device dump + one-off captures. Third-party modules installed after the fleet
 * dump (scripts/capture-module.mjs) are merged here rather than written into
 * device-dump.json, which dump-modules.sh regenerates wholesale. */
export function loadDump() {
    const dump = JSON.parse(readFileSync(join(DUMP_DIR, 'device-dump.json'), 'utf8'));
    if (existsSync(EXTRA_DIR)) {
        for (const f of readdirSync(EXTRA_DIR).sort()) {
            if (f.endsWith('.json')) {
                const extra = JSON.parse(readFileSync(join(EXTRA_DIR, f), 'utf8'));
                upsertModule(dump.modules, extra);
            }
        }
    }
    if (existsSync(CONTRACT_DIR)) {
        for (const f of readdirSync(CONTRACT_DIR).sort()) {
            if (!f.endsWith('.json')) continue;
            const moduleJson = JSON.parse(readFileSync(join(CONTRACT_DIR, f), 'utf8'));
            upsertModule(dump.modules, entryFromModuleContract(moduleJson));
        }
    }
    return dump;
}

/* Install the env/os/host stubs and return a boot function bound to this dump.
 * movy_config.json overrides are looked up by module id under the
 * sound_generators root (src/modules/loader.ts); serve the captured ones. Each
 * config sits at a module-unique path, so one map with no per-module reset is
 * hermetic. env.setParams() below replaces the whole store per module. */
export async function createDumpBoot(dump) {
    const env = installEnv();
    globalThis.os = {
        readdir: () => [[], 0],
        stat:    () => [{ mode: 0x8000, size: 0 }, 0],
    };
    const movyConfigByPath = {};
    for (const m of dump.modules) {
        if (m.movy_config) {
            movyConfigByPath[`/data/UserData/schwung/modules/sound_generators/${m.id}/movy_config.json`] =
                JSON.stringify(m.movy_config);
        }
    }
    // Forge ships its own movy_config.json (canonical: forge-move repo,
    // src/movy_config.json); serve the fixture snapshot so the replay matches
    // the device. Keep the fixture in sync when the forge-move layout changes.
    const forgeLayout = readFileSync(join(MOVY, 'browser-test', 'fixtures', 'forge-movy-config.json'), 'utf8');
    movyConfigByPath['/data/UserData/schwung/modules/sound_generators/forge/movy_config.json'] = forgeLayout;
    globalThis.host_read_file = (path) => movyConfigByPath[path] ?? null;

    const { createModel } = await import(join(MOVY, 'dist', 'esm', 'model', 'index.js'));

    function bootFromDumpEntry(entry) {
        const ck = entry.component_key;
        const params = {};
        for (const [k, v] of Object.entries(entry.params)) {
            if (k.startsWith('__')) continue;
            params[`${ck}:${k}`] = v;
        }
        params[`${ck}_module`] = entry.id;
        if (params[`${ck}:name`] === undefined) {
            params[`${ck}:name`] = entry.module_json?.name || entry.id;
        }
        env.setParams(params);
        const m = createModel(0, ck);
        m.reload();
        m.tick();   // poll name → hierarchy key change
        m.tick();   // load hierarchy
        return m;
    }

    return { env, bootFromDumpEntry };
}

/* Per-page view (what the user sees, incl. envelope/LFO groups and the deduped
 * 5-char on-screen names). Both consumers derive from this: the generator maps
 * lfoVizCount → a boolean; the suite snapshots the counts directly. */
export function serializePages(model) {
    const pages = [];
    const pageCount = model.getBankCount();
    for (let pg = 0; pg < pageCount; pg++) {
        const vm = model.getViewModel();
        pages.push({
            name: vm.bankName,
            envelopeLines: (vm.envelopeLines ?? []).map(e => e !== null && e !== undefined),
            lfoVizCount: (vm.lfoViz ?? []).length,
            rows: vm.rows.map(row => row.map(pvm => pvm && {
                shortName:   pvm.shortName,
                fullName:    pvm.fullName,
                renderStyle: pvm.renderStyle,
                type:        pvm.type,
                displayValue: pvm.displayValue,
            })),
        });
        model.changePage(1);
    }
    return pages;
}

/* Expand a drum pad-alias key ("pad_vol") into the concrete per-pad keys it
 * covers ("p01_vol".."p16_vol"), mirroring model/pad-scope.ts. Used to decide
 * which native chain_params are actually reachable in movy. */
export function expandLayoutKeys(layout) {
    const keys = new Set();
    const sc = layout.drum?.padScoping;
    for (const p of layout.params) {
        if (!p) continue;
        keys.add(p.key);
        if (sc && p.key.startsWith(sc.aliasPrefix)) {
            const suffix = p.key.slice(sc.aliasPrefix.length);
            for (let pad = 1; pad <= (layout.drum.padCount || 0); pad++) {
                const padStr = String(pad).padStart(sc.padDigits, '0');
                keys.add(sc.concreteKeyTemplate.replace('{pad}', padStr).replace('{suffix}', suffix));
            }
        }
    }
    return keys;
}
