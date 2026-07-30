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

async function readModule(ws, slot, component) {
    const msgs = [];
    const h = (ev) => { try { msgs.push(JSON.parse(ev.data)); } catch {} };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ type: 'get_hierarchy', slot }));
    await sleep(1200);
    ws.removeEventListener('message', h);
    /* Track components expose the loaded id under the underscore alias
     * (`fx1_module`); the colon key is write-only for them. */
    for (const m of msgs.reverse()) {
        const p = m.params ?? m.data;
        if (p && typeof p === 'object') {
            const v = p[`${component}_module`] ?? p[`${component}:module`];
            if (v != null) return String(v);
        }
        if (m.type === 'slot_info' && m.slot === slot && component === 'synth' && m.synth) return m.synth;
    }
    return '';
}

const [mode, slotArg, component, value] = process.argv.slice(2);
const slot = parseInt(slotArg ?? '0', 10);
const ws = await open();
try {
    if (mode === 'get') {
        console.log(await readModule(ws, slot, component));
    } else if (mode === 'set') {
        ws.send(JSON.stringify({ type: 'set_param', slot, key: `${component}:module`, value }));
        await sleep(1500);
        console.log(await readModule(ws, slot, component));
    } else {
        console.error('usage: module-slot.mjs get|set <slot> <component> [id]');
        process.exit(2);
    }
} finally {
    ws.close();
    await sleep(100);
    process.exit(0);
}
