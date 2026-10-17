/* browser-test/dump-boot.mjs — shared replay core for the checked-in device
 * dump (docs/module-dump/device-dump.json).
 *
 * Suites that need a real module boot the REAL model per module through the
 * browser-test env stubs. That boot is the only tricky shared logic
 * (componentKey-prefixed param map, synth_module/name fallback, movy_config
 * host_read_file serving, createModel + reload + 2 ticks); it lives here once.
 */

import { portFor } from '../dist/esm/track/registry.js';
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

/* The host a boot takes away: `os` — which the file stubs and every overlay's
 * readdir ride on — and `host_read_file`, which serves a module's shipped
 * layouts. Captured ONCE per process, at the first boot, because that is the
 * only moment the pair on the globals is the harness's own: a later boot would
 * record whichever earlier boot's stubs were left behind and hand those back.
 * (The catalogues those two answer from are the harness's, not the env's:
 * `logic/harness.mjs` replaces `os` with its own readdir-backed one after
 * installEnv(), so capturing at install time would restore a stub that cannot
 * list a directory at all.) */
let hostBeforeBoot = null;

/* Install the env/os/host stubs and return a boot function bound to this dump.
 * movy_config.json overrides are looked up by module id under the
 * sound_generators root (src/modules/loader.ts); serve the captured ones. Each
 * config sits at a module-unique path, so one map with no per-module reset is
 * hermetic. env.setParams() below replaces the whole store per module. */
export async function createDumpBoot(dump) {
    const env = installEnv();
    hostBeforeBoot ??= { os: globalThis.os, readFile: globalThis.host_read_file };
    /* A suite that boots a dump gives the pair back in cleanup — this is the
     * restorer, beside `env.restoreParamGlobals`, and the
     * reason the suite order stopped mattering: without a call to it, every
     * suite after the boot runs on the stubs installed below instead of the
     * harness's. */
    env.restoreHostGlobals = () => {
        globalThis.os = hostBeforeBoot.os;
        globalThis.host_read_file = hostBeforeBoot.readFile;
    };
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
    /* module.json is readable on the device for EVERY module, and movy reads it
     * when the host serves no ui_hierarchy (model/hierarchy.ts). Serving the
     * dumped manifests is what makes the replay answer "does this module still
     * lay out the same way on a real device", rather than "…on a device where
     * no manifest exists". */
    for (const m of dump.modules) {
        if (!m.module_json) continue;
        const dir = m.component_key === 'synth' ? 'sound_generators'
                  : String(m.component_key ?? '').startsWith('midi_fx') ? 'midi_fx' : 'audio_fx';
        movyConfigByPath[`/data/UserData/schwung/modules/${dir}/${m.id}/module.json`] =
            JSON.stringify(m.module_json);
    }
    /* The modules in OVERRIDES_MODULE_FILE (src/modules/loader.ts) do NOT get
     * their own movy_config.json on the device: movy reads the replacement
     * shipped beside ui.js instead, and it reads it BEFORE the module's own —
     * that list exists precisely because the shipped layouts are unusable (they
     * pad-declare every bank, which movy reads as "every bank is a voice" and
     * collapses the whole module to one page). Serve those files from the repo
     * copy, the way browser-test/env.mjs already does; without them the replay
     * boots those modules against the exact layout the override replaces. Note
     * the served key must match `${MOVY_TOOL_ROOT}/configs/<id>.json`, not the
     * module directory. */
    const overrideDir = join(MOVY, 'src', 'module-configs');
    if (existsSync(overrideDir)) {
        for (const f of readdirSync(overrideDir)) {
            if (!f.endsWith('.json')) continue;
            try {
                movyConfigByPath[`/data/UserData/schwung/modules/tools/movy/configs/${f}`] =
                    readFileSync(join(overrideDir, f), 'utf8');
            } catch { /* unreadable override: leave it unserved, the loader warns */ }
        }
    }
    /* Replaces the env's reader for the life of the process: the pair this and
     * the `os` above take is what `env.restoreHostGlobals` gives back. */
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
        const m = createModel(portFor(0), ck);
        m.reload();
        m.tick();   // poll name → hierarchy key change
        m.tick();   // load hierarchy
        return m;
    }

    return { env, bootFromDumpEntry };
}
