#!/usr/bin/env node
/* slots-read.mjs — read every chain slot's loaded synth over ONE remote-UI
 * WebSocket connection, printing `<slot> <module>` per line ("-" when empty).
 *
 * module-slot.mjs opens a fresh connection per slot and waits for that slot's
 * reply, so reading four slots cost four connections and several seconds each.
 * The fixture reads all four twice per attempt, which made establishing it the
 * single most expensive thing a device test did (~30 s per attempt). The device
 * answers a get_hierarchy for every slot on one socket, so this asks for all of
 * them up front and collects the replies as they land.
 *
 * Exit 3 = at least one slot never answered. Callers must not treat silence as
 * "empty": that is how a verify would accept a slot that never loaded.
 *
 * Env: HOST (default move.local), SLOTS (default "0 1 2 3").
 */
const HOST = process.env.HOST || 'move.local';
const SLOTS = (process.env.SLOTS || '0 1 2 3').trim().split(/\s+/).map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(`ws://${HOST}:7700/ws/remote-ui`);
const info = new Map();
ws.onmessage = (ev) => {
    try {
        const m = JSON.parse(ev.data);
        if (m.type === 'slot_info' && typeof m.slot === 'number') info.set(m.slot, m);
    } catch { /* ignore non-JSON frames */ }
};
await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('ws connect timeout')), 5000);
    ws.onopen = () => { clearTimeout(to); res(); };
    ws.onerror = (e) => { clearTimeout(to); rej(new Error('ws error: ' + (e?.message || e))); };
});

for (const s of SLOTS) ws.send(JSON.stringify({ type: 'get_hierarchy', slot: s }));

const deadline = Date.now() + 10000;
while (info.size < SLOTS.length && Date.now() < deadline) await sleep(100);
ws.close();

let missing = 0;
for (const s of SLOTS) {
    const m = info.get(s);
    if (!m) { missing++; console.error(`slots-read: slot ${s} never answered`); continue; }
    console.log(`${s} ${m.synth || '-'}`);
}
await sleep(50);
process.exit(missing ? 3 : 0);
