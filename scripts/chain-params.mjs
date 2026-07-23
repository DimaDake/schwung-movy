#!/usr/bin/env node
/* Reusable chain-host param probe over the schwung remote-UI WebSocket
 * (port 7700, route /ws/remote-ui). Talks the same shm the chain host reads,
 * so `set_param synth:module=<id>` triggers the exact hot-swap movy's module
 * reselect does — no device UI, no MIDI, no manual gestures.
 *
 * Purpose: the abs-CC step-automation playback path in the chain host resolves
 * a param via find_param_info(synth_params, …). For self-describing modules
 * (obxd, weird-dreams, noisemaker) that ship no static params in module.json,
 * synth_params is populated only from the plugin's DYNAMIC chain_params — which
 * come back EMPTY after a hot `synth:module` reselect, so automation goes
 * silently inaudible while the UI still renders. This probe reads a component's
 * chain_params count so a repro/regression can assert it survives a reselect.
 *
 * Modes:
 *   probe [slot]                     one get_hierarchy; print module + counts
 *   reselect [slot] [id]             reselect (id defaults to current synth);
 *                                    print counts before/after
 *   experiment [slot] [id]           reselect, then try recovery candidates,
 *                                    printing the synth chain_params count after
 *                                    each — finds what re-populates params
 *   assert-survives [slot] [id]      exit 0 if chain_params survive a reselect,
 *                                    1 otherwise (regression test)
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

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

/* Fire get_hierarchy and collect the burst; return {synth, counts:{comp:n}}. */
async function probe(ws, slot, windowMs = 1000) {
    const msgs = [];
    const h = (ev) => { try { msgs.push(JSON.parse(ev.data)); } catch {} };
    ws.addEventListener('message', h);
    send(ws, { type: 'get_hierarchy', slot });
    await sleep(windowMs);
    ws.removeEventListener('message', h);
    let synth = null;
    const counts = {};
    for (const m of msgs) {
        if (m.type === 'slot_info' && m.slot === slot) synth = m.synth;
        if (m.type === 'chain_params' && m.slot === slot) {
            counts[m.component] = Array.isArray(m.data) ? m.data.length : null;
        }
    }
    return { synth, counts };
}

async function setParam(ws, slot, key, value, settleMs = 500) {
    send(ws, { type: 'set_param', slot, key, value });
    await sleep(settleMs);
}

const synthCount = (p) => (p.counts.synth ?? 0);

async function main() {
    const mode = process.argv[2] || 'probe';
    const slot = parseInt(process.argv[3] ?? '0', 10);
    const idArg = process.argv[4];
    const ws = await open();
    let exit = 0;
    try {
        const base = await probe(ws, slot);
        const id = idArg || base.synth;
        console.log(`[chain-params] host=${HOST} slot=${slot} synth=${base.synth || '(none)'}`);
        console.log(`[chain-params] baseline counts: ${JSON.stringify(base.counts)}`);

        if (mode === 'dump') {
            // Print the full synth chain_params JSON (from the plugin, current
            // state) — the source for baking static params into a module.json.
            const msgs = [];
            const h = (ev) => { try { msgs.push(JSON.parse(ev.data)); } catch {} };
            ws.addEventListener('message', h);
            send(ws, { type: 'get_hierarchy', slot });
            await sleep(1200);
            ws.removeEventListener('message', h);
            const cp = msgs.filter((m) => m.type === 'chain_params' && m.slot === slot && m.component === 'synth').pop();
            console.log(JSON.stringify(cp?.data ?? [], null, 1));
            return;
        }

        if (mode === 'probe') return;
        if (!id) { console.error('[chain-params] no synth module on this slot — pass an id'); exit = 2; return; }

        if (mode === 'reselect' || mode === 'assert-survives') {
            await setParam(ws, slot, 'synth:module', id);
            const after = await probe(ws, slot);
            console.log(`[chain-params] after reselect(${id}): synth chain_params = ${synthCount(after)} (was ${synthCount(base)})`);
            if (mode === 'assert-survives') {
                const ok = synthCount(after) > 0;
                console.log(ok
                    ? `PASS: chain_params survived reselect (${synthCount(after)} params)`
                    : `FAIL: chain_params EMPTY after reselect — abs-CC automation will be inaudible`);
                exit = ok ? 0 : 1;
            }
            return;
        }

        if (mode === 'ab') {
            // A/B the two reload paths N times to see which deterministically
            // keeps chain_params non-empty: fresh load (none→id, what a set
            // reopen/"restart" does) vs same-module reload (id→id, what movy's
            // reselect does today). Run on an UNFOCUSED slot to avoid movy's
            // concurrent shm contention on the active slot.
            const N = parseInt(process.argv[5] ?? '5', 10);
            const freshN = [], sameN = [];
            for (let i = 0; i < N; i++) {
                await setParam(ws, slot, 'synth:module', 'none');
                await setParam(ws, slot, 'synth:module', id);
                freshN.push(synthCount(await probe(ws, slot)));
                await setParam(ws, slot, 'synth:module', id);
                sameN.push(synthCount(await probe(ws, slot)));
            }
            console.log(`[ab] fresh (none→${id}): ${JSON.stringify(freshN)}`);
            console.log(`[ab] same  (${id}→${id}): ${JSON.stringify(sameN)}`);
            const nz = (a) => a.filter((n) => n > 0).length;
            console.log(`[ab] non-empty: fresh ${nz(freshN)}/${N}, same ${nz(sameN)}/${N}`);
            return;
        }

        if (mode === 'experiment') {
            const report = async (label) => {
                const p = await probe(ws, slot);
                console.log(`  [${label}] synth chain_params = ${synthCount(p)}`);
                return synthCount(p);
            };
            console.log(`[experiment] reselecting ${id} to reproduce the empty-params state…`);
            await setParam(ws, slot, 'synth:module', id);
            await report('after reselect');

            // Recovery candidates — each tries to re-populate synth_params the way
            // a set reopen ("restart") apparently does. Printed count after each
            // tells us which movy could replicate on reselect.
            const candidates = [
                ['reselect again',        async () => setParam(ws, slot, 'synth:module', id)],
                ['none then reselect',    async () => { await setParam(ws, slot, 'synth:module', 'none'); await setParam(ws, slot, 'synth:module', id); }],
                ['preset 0',              async () => setParam(ws, slot, 'synth:preset', '0')],
                ['preset_index 0',        async () => setParam(ws, slot, 'synth:preset_index', '0')],
            ];
            for (const [label, act] of candidates) {
                await act();
                const n = await report(label);
                if (n > 0) { console.log(`[experiment] RECOVERED via: ${label}`); break; }
            }
            return;
        }

        console.error(`[chain-params] unknown mode: ${mode}`);
        exit = 2;
    } finally {
        ws.close();
        // Give the close frame a moment, then hard-exit (WebSocket keeps the loop alive).
        await sleep(100);
        process.exit(exit);
    }
}

main().catch((e) => { console.error('[chain-params] ' + (e?.stack || e)); process.exit(3); });
