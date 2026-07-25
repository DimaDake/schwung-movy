#!/usr/bin/env node
/* capture-module.mjs — snapshot ONE installed module as a dump-replay fixture.
 *
 * The fleet dump (scripts/dump-modules.sh) loads all 76 modules and is
 * destructive, so third-party modules that arrive later (helm, …) get captured
 * one at a time over the remote-UI WebSocket instead and are merged into the
 * replay by browser-test/dump-boot.mjs.
 *
 * Usage: node scripts/capture-module.mjs <slot> [host]
 *   The module must already be loaded on <slot>'s synth component.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..');
const slot = parseInt(process.argv[2] ?? '0', 10);
const HOST = process.argv[3] || process.env.HOST || 'move.local';
const SETTLE_MS = 12000;   // params arrive in batches of 8

const ws = new WebSocket(`ws://${HOST}:7700/ws/remote-ui`);
const msgs = [];
ws.onmessage = (ev) => { try { msgs.push(JSON.parse(ev.data)); } catch {} };
ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', slot }));

setTimeout(() => {
    const mine = (t) => msgs.filter(m => m.type === t && m.slot === slot
        && (m.component ?? 'synth') === 'synth');
    const hier = mine('hierarchy').pop()?.data;
    const cp   = mine('chain_params').pop()?.data;
    const id   = msgs.filter(m => m.type === 'slot_info' && m.slot === slot).pop()?.synth;
    if (!hier || !cp || !id) {
        console.error(`capture failed: hierarchy=${!!hier} chain_params=${!!cp} id=${id}`);
        process.exit(1);
    }
    const values = {};
    for (const m of mine('param_update')) {
        for (const [k, v] of Object.entries(m.params ?? {})) {
            if (k.startsWith('synth:')) values[k.slice(6)] = String(v);
        }
    }
    const entry = {
        id, dir: id, category: 'sound_generator', component_key: 'synth',
        status: 'ok', module_json: null, movy_config: null,
        ui_hierarchy: hier, chain_params: cp,
        presets: {
            list_param:  hier.levels?.root?.list_param  ?? null,
            count_param: hier.levels?.root?.count_param ?? null,
            name_param:  hier.levels?.root?.name_param  ?? null,
            count: parseInt(values.preset_count ?? '0', 10), names: null,
        },
        params: {
            ...values,
            ui_hierarchy: JSON.stringify(hier),
            chain_params: JSON.stringify(cp),
        },
    };
    const out = join(MOVY, 'browser-test', 'fixtures', 'dump-extra',
        `sound_generator--${id}.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(entry, null, 1) + '\n');
    console.log(`wrote ${out}  (${cp.length} chain_params, ` +
        `${Object.keys(hier.levels ?? {}).length} levels, ` +
        `${Object.keys(values).length} values)`);
    process.exit(0);
}, SETTLE_MS);
