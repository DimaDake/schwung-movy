#!/usr/bin/env node
/* slot-state.mjs — send one chain-slot param over the schwung remote-UI
 * WebSocket (port 7700, /ws/remote-ui). Same transport as module-slot.mjs,
 * but for the slot-level verbs schwung itself uses when it switches sets:
 *
 *   slot-state.mjs clear     <slot>          empty the slot
 *   slot-state.mjs load      <slot> <path>   restore module + every param value
 *   slot-state.mjs module    <slot> <id>     load a synth module (creates the
 *                                            slot's chain instance)
 *
 * Verified device behaviour (2026-08-01):
 *   - `load_file` restores the whole slot — module AND parameter state — from
 *     a JSON file in schwung's own slot format, which is what makes a fixture
 *     reproducible rather than merely "the right module is loaded".
 *   - `load_file` acts on the slot's existing chain instance, so it is a no-op
 *     on a cleared or never-loaded slot. Send `module` first to create one.
 *   - Never point it at set_state/<uuid>/: schwung autosaves over that
 *     directory, so a fixture kept there silently becomes whatever ran last.
 *
 * Env: HOST (default move.local).
 */
const HOST = process.env.HOST || 'move.local';
const URL = `ws://${HOST}:7700/ws/remote-ui`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [verb, slotArg, value] = process.argv.slice(2);
const slot = parseInt(slotArg ?? '0', 10);

const KEYS = { clear: 'clear', load: 'load_file', module: 'synth:module' };
const key = KEYS[verb];
if (!key || !Number.isInteger(slot)) {
    console.error('usage: slot-state.mjs clear|load|module <slot> [path|id]');
    process.exit(2);
}
if (verb !== 'clear' && !value) {
    console.error(`slot-state.mjs ${verb} needs a ${verb === 'load' ? 'path' : 'module id'}`);
    process.exit(2);
}

const ws = new WebSocket(URL);
const errors = [];
ws.onmessage = (ev) => {
    try { const m = JSON.parse(ev.data); if (m.type === 'error') errors.push(m.message ?? JSON.stringify(m)); } catch {}
};
await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('ws connect timeout')), 5000);
    ws.onopen = () => { clearTimeout(to); res(); };
    ws.onerror = (e) => { clearTimeout(to); rej(new Error('ws error: ' + (e?.message || e))); };
});
ws.send(JSON.stringify({ type: 'set_param', slot, key, value: value ?? '' }));
await sleep(2000);
ws.close();
if (errors.length) { console.error('slot-state: ' + errors.join('; ')); process.exit(1); }
process.exit(0);
