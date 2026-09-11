#!/usr/bin/env node
/* slot-param.mjs — read a schwung slot's live param values from a device test.
 *
 * `get_hierarchy` (module-slot.mjs's mechanism) answers with `slot_info`
 * (module ids only), `hierarchy` and `chain_params` (structure — param
 * DEFINITIONS, never current values) — verified on device: none of the three
 * carry a value for an arbitrary key like `slot:volume`.
 *
 * `{ type: 'subscribe', slot }` does: it triggers an immediate snapshot burst
 * of `param_update` messages, each `{ params: { "lfo1:depth": "0.00", … } }` —
 * every FLAT field the shim tracks for that slot, values included. Also
 * verified on device. Not everything schwung answers `shadow_get_param` with
 * internally shows up here, though — `synth:state` (the whole-module preset
 * blob movy's migration also reads) never broadcasts over this channel; it
 * appears to be assembled only for the shim's own internal callers. A rename
 * of that ONE key is caught by test-migrate.sh's positive arm instead — a
 * migrated chain with no preset blob fails distinctly there — not by this
 * script.
 *
 *   slot-param.mjs get <slot> <key>
 *
 * Prints the value, or nothing (exit 3) if the device never answered — which a
 * caller must not read as "the key is empty".
 *
 * Env: HOST (default move.local).
 */
const HOST = process.env.HOST || 'move.local';
const URL = `ws://${HOST}:7700/ws/remote-ui`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
    return new Promise((res, rej) => {
        const ws = new WebSocket(URL);
        const to = setTimeout(() => rej(new Error('ws connect timeout')), 5000);
        ws.onopen = () => { clearTimeout(to); res(ws); };
        ws.onerror = (e) => { clearTimeout(to); rej(new Error('ws error: ' + (e?.message || e))); };
    });
}

/* Returns the value, '' if the snapshot answered but the key was not in it, or
 * null if the device never answered at all — module-slot.mjs's three-way
 * distinction, for the same reason: a busy device must not read as an empty
 * key, or a canary would fail claiming a rename that never happened. */
async function readKey(ws, slot, key) {
    let seenUpdate = false;
    let value = null;
    const h = (ev) => {
        try {
            const m = JSON.parse(ev.data);
            if (m.type === 'param_update' && m.slot === slot && m.params) {
                seenUpdate = true;
                if (Object.prototype.hasOwnProperty.call(m.params, key)) value = String(m.params[key]);
            }
        } catch {}
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ type: 'subscribe', slot }));
    const deadline = Date.now() + 8000;
    while (!seenUpdate && Date.now() < deadline) await sleep(100);
    if (seenUpdate) await sleep(1000);   // the snapshot burst arrives over a few messages
    ws.removeEventListener('message', h);
    if (!seenUpdate) return null;
    return value ?? '';
}

const [mode, slotArg, key] = process.argv.slice(2);
if (mode !== 'get' || slotArg === undefined || !key) {
    console.error('usage: slot-param.mjs get <slot> <key>');
    process.exit(2);
}
const slot = parseInt(slotArg, 10);
const ws = await open();
let code = 0;
try {
    const v = await readKey(ws, slot, key);
    if (v === null) { console.error('slot-param: no answer from device'); code = 3; }
    else console.log(v);
} finally {
    ws.close();
    await sleep(100);
    process.exit(code);
}
