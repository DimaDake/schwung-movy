#!/usr/bin/env node
/* probe-async-meta.mjs — does this module publish its preset list and enum
 * options AFTER it loads, and does it republish chain_params when it does?
 *
 * Osirus scans its Virus ROM asynchronously: right after load it reports
 * preset_count 0 and rom_index ["(loading)"]. movy's meta-retry.ts re-probes on
 * the name-poll cadence and rebuilds its pages once the real values land — this
 * script is how that behaviour is checked against a real module instead of a
 * mock.
 *
 * Loads the module itself (so the "just loaded" window is real), then samples
 * the interesting keys immediately and again after a settle delay.
 *
 *   node scripts/probe-async-meta.mjs <slot> [module-id] [host]
 *
 * With no module-id it profiles whatever is already on <slot>'s synth. When it
 * loads a module it restores the previous one on exit.
 *
 * Env: HOST (default move.local).
 */
const slot   = parseInt(process.argv[2] ?? '0', 10);
const loadId = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const HOST   = process.argv[4] || process.env.HOST || 'move.local';
const URL    = `ws://${HOST}:7700/ws/remote-ui`;
const SETTLE_MS = 15000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function open() {
    return new Promise((res, rej) => {
        const ws = new WebSocket(URL);
        const to = setTimeout(() => rej(new Error('ws connect timeout')), 5000);
        ws.onopen  = () => { clearTimeout(to); res(ws); };
        ws.onerror = (e) => { clearTimeout(to); rej(new Error('ws error: ' + (e?.message || e))); };
    });
}
const send = (ws, o) => ws.send(JSON.stringify(o));

/* One get_hierarchy round trip → the synth's chain_params, param values and the
 * loaded module id, plus how many chain_params messages arrived (a republish
 * during the window is itself the signal movy could key off). */
async function sample(ws, windowMs = 6000) {
    const msgs = [];
    const h = (ev) => { try { msgs.push(JSON.parse(ev.data)); } catch {} };
    ws.addEventListener('message', h);
    /* The protocol has no get_param: `subscribe` is what makes the host push
     * initial param VALUES, get_hierarchy only re-sends the metadata. Both are
     * needed to see preset_count/preset_names, which are values, not
     * chain_params entries. */
    send(ws, { type: 'unsubscribe', slot });
    send(ws, { type: 'subscribe', slot });
    send(ws, { type: 'get_hierarchy', slot });
    await sleep(windowMs);
    ws.removeEventListener('message', h);

    const mine = (t) => msgs.filter(m => m.type === t && m.slot === slot
        && (m.component ?? 'synth') === 'synth');
    const cpMsgs = mine('chain_params');
    const cp = cpMsgs.pop()?.data ?? [];
    const values = {};
    for (const m of mine('param_update')) {
        for (const [k, v] of Object.entries(m.params ?? {})) {
            if (k.startsWith('synth:')) values[k.slice(6)] = String(v);
        }
    }
    return {
        id: msgs.filter(m => m.type === 'slot_info' && m.slot === slot).pop()?.synth ?? null,
        republishes: cpMsgs.length,
        cpCount: cp.length,
        entry: (key) => cp.find(p => p.key === key) ?? null,
        values,
    };
}

const WATCH = ['preset', 'preset_count', 'bank_index', 'rom_index'];

function report(label, s) {
    console.log(`\n── ${label} ──`);
    console.log(`module=${s.id} chain_params=${s.cpCount} chain_params messages=${s.republishes}`);
    console.log(`preset_count value = ${s.values.preset_count ?? '(unset)'}`);
    console.log(`preset_names       = ${(s.values.preset_names ?? '(unset)').slice(0, 120)}`);
    for (const k of WATCH) {
        const e = s.entry(k);
        if (!e) { console.log(`${k.padEnd(14)} — not in chain_params`); continue; }
        const range = e.options ? `options=${JSON.stringify(e.options).slice(0, 120)}`
                                : `min=${e.min} max=${e.max}`;
        console.log(`${k.padEnd(14)} type=${e.type} ${range}  value=${s.values[k] ?? '(unset)'}`);
    }
}

const ws = await open();
let restoreTo = null;
try {
    const before = await sample(ws, 3000);
    if (loadId && loadId !== before.id) {
        restoreTo = before.id;
        console.log(`[probe] loading ${loadId} on slot ${slot} (will restore ${restoreTo || 'none'})`);
        send(ws, { type: 'set_param', slot, key: 'synth:module', value: loadId });
        await sleep(2500);
    }

    report('immediately after load', await sample(ws));
    console.log(`\n[probe] waiting ${SETTLE_MS / 1000}s for asynchronous metadata …`);
    await sleep(SETTLE_MS);
    report(`after ${SETTLE_MS / 1000}s`, await sample(ws));
} finally {
    if (restoreTo) {
        send(ws, { type: 'set_param', slot, key: 'synth:module', value: restoreTo });
        await sleep(1500);
        console.log(`\n[probe] restored ${restoreTo} on slot ${slot}`);
    }
    ws.close();
}
