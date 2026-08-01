#!/usr/bin/env node
/* module-slot.mjs — read/write a chain component's loaded module over the
 * schwung remote-UI WebSocket (port 7700, /ws/remote-ui), so a device test can
 * park a module in a slot and put the slot back afterwards without touching the
 * device UI. Same transport as scripts/chain-params.mjs.
 *
 * Track FX slots take the module id; master FX slots take the full DSP path
 * (schwung's asymmetry) — only track slots are handled here.
 *
 *   module-slot.mjs get <slot> <component>            print current id (or "")
 *   module-slot.mjs set <slot> <component> <id|none>  load it
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

/* Returns the loaded id, '' when the component is definitively empty, or null
 * when the device never answered.
 *
 * That three-way distinction is the point. The old version slept a fixed 1200ms
 * and returned '' both for "empty" and for "no reply yet", so reads were flaky
 * under load — and a caller snapshotting the chain could record "empty" for a
 * busy device, then restore that emptiness over a real module.
 *
 * slot_info answers for every component at once (synth/fx1/fx2/midi_fx1, '' when
 * empty) and is the first message the device sends, so waiting for it is both
 * reliable and complete. The params scan stays as a fallback for any component
 * slot_info does not name. */
async function readModule(ws, slot, component) {
    const msgs = [];
    let info = null;
    const h = (ev) => {
        try {
            const m = JSON.parse(ev.data);
            msgs.push(m);
            if (m.type === 'slot_info' && m.slot === slot) info = m;
        } catch {}
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ type: 'get_hierarchy', slot }));
    const deadline = Date.now() + 8000;
    while (!info && Date.now() < deadline) await sleep(100);
    if (info) await sleep(800);   // let hierarchy/chain_params land too
    ws.removeEventListener('message', h);
    if (!info) return null;
    if (Object.prototype.hasOwnProperty.call(info, component)) return String(info[component] ?? '');
    /* Track components expose the loaded id under the underscore alias
     * (`fx1_module`); the colon key is write-only for them. */
    for (const m of msgs.reverse()) {
        const p = m.params ?? m.data;
        if (p && typeof p === 'object') {
            const v = p[`${component}_module`] ?? p[`${component}:module`];
            if (v != null) return String(v);
        }
    }
    return '';
}

const [mode, slotArg, component, value] = process.argv.slice(2);
const slot = parseInt(slotArg ?? '0', 10);
const ws = await open();
/* Exit 3 = the device never answered, so stdout says nothing about the slot.
 * Callers that snapshot state must retry rather than treat silence as "empty". */
let code = 0;
try {
    if (mode === 'get') {
        const v = await readModule(ws, slot, component);
        if (v === null) { console.error('module-slot: no answer from device'); code = 3; }
        else console.log(v);
    } else if (mode === 'set') {
        ws.send(JSON.stringify({ type: 'set_param', slot, key: `${component}:module`, value }));
        await sleep(1500);
        const v = await readModule(ws, slot, component);
        if (v === null) { console.error('module-slot: no answer from device'); code = 3; }
        else console.log(v);
    } else {
        console.error('usage: module-slot.mjs get|set <slot> <component> [id]');
        code = 2;
    }
} finally {
    ws.close();
    await sleep(100);
    process.exit(code);
}
