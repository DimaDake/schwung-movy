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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DUMP_DIR = join(MOVY, 'docs', 'module-dump');

export function loadDump() {
    return JSON.parse(readFileSync(join(DUMP_DIR, 'device-dump.json'), 'utf8'));
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
