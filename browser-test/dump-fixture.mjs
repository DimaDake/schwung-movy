/* dump-fixture.mjs — a mock synth built from a REAL module's device metadata.
 *
 * WHY THIS EXISTS. Every number in docs/schwung-page-migration.md up to SP-26
 * was taken against `hier_params_overflow_two_levels` (11 params, 2 levels) or
 * on device against plaits (14 params, 1 level). Those are the SMALLEST shapes
 * in the fleet. The complaint SP-27 is about is minijv: 433 params and 57
 * hierarchy levels, the LARGEST — a 31x/57x ratio. An instrument that only ever
 * ran the best case cannot see a cost that scales with module size, which is
 * exactly why SP-27 sat open as "~1.9 ms of CPU" with no attribution.
 *
 * WHY THE DUMP AND NOT A HAND-WRITTEN MOCK. `docs/module-dump/device-dump.json`
 * records, per module, the flat map its shadow params actually answered on the
 * device — `ui_hierarchy` and `chain_params` included, as the JSON STRINGS the
 * wire carries. So a fixture built from it is not a model of the module, it is
 * the module's own metadata replayed: real key names, real enum option lists,
 * real child-level templates, the real 57-level hierarchy. A synthetic "200
 * params on one level" mock flattens away the very shape the expensive path
 * walks. It also cannot drift from the device without the dump drifting too,
 * which dump-replay.mjs already gates.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMP_PATH = resolve(HERE, '../docs/module-dump/device-dump.json');

let byId = null;
function modules() {
    if (!byId) {
        const raw = JSON.parse(readFileSync(DUMP_PATH, 'utf8'));
        byId = new Map((raw.modules ?? []).map(m => [m.id, m]));
    }
    return byId;
}

/** Every module id the dump carries, for a caller that wants to sweep. */
export function dumpModuleIds() { return [...modules().keys()]; }

/**
 * The raw dump entry for `id`, or throw — a silent miss here would boot a
 * fixture with no params at all and read as "the big module is free".
 */
export function dumpEntry(id) {
    const e = modules().get(id);
    if (!e) throw new Error(`dump-fixture: no module '${id}' in device-dump.json`);
    return e;
}

/**
 * A `MOCK_SYNTHS`-shaped flat param map for module `id`, under component `ck`.
 *
 * The dump's `params` is already the shadow store, so this is a prefix and a
 * `String()` — deliberately NOT a re-derivation. The only thing added is a
 * value for a declared param the dump has no reading for: an absent key makes
 * the env answer `null`, which is "the channel declined to answer" and gets
 * re-asked forever (SP-26's tri-state), so leaving it out would invent a read
 * loop no device with this module loaded actually pays.
 */
export function dumpFixture(id, { ck = 'synth' } = {}) {
    const e = dumpEntry(id);
    const out = {};
    for (const [k, v] of Object.entries(e.params ?? {})) {
        if (v === null || v === undefined) continue;
        out[`${ck}:${k}`] = String(v);
    }
    for (const p of e.chain_params ?? []) {
        if (!p || !p.key) continue;
        const at = `${ck}:${p.key}`;
        if (out[at] !== undefined) continue;
        out[at] = p.default !== undefined && p.default !== null ? String(p.default) : '0';
    }
    /* movy reads the loaded module's id separately from its params. */
    out[`${ck}_module`] = id;
    return out;
}

/** What the fixture is, for a run banner: the numbers that make it the big case. */
export function dumpShape(id) {
    const e = dumpEntry(id);
    let levels = 0;
    try { levels = Object.keys(JSON.parse(e.params?.ui_hierarchy ?? '{}').levels ?? {}).length; }
    catch { levels = 0; }
    return { id, params: (e.chain_params ?? []).length, levels };
}
