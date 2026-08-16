#!/usr/bin/env node
/* engine-param.mjs — read/write a movy ENGINE param from a device test.
 *
 * Movy's engine (the overtake DSP) is reachable from outside the device UI:
 * schwung's remote-UI WebSocket routes any key prefixed `overtake_dsp:` through
 * the reliable shadow_param ring, which the shim hands to whichever DSP is
 * loaded as overtake (schwung-manager/remote_ui.go:167). That is exactly the
 * path `host_module_set_param` takes on-device — shadow_ui.js:3540 defines it as
 * `shadow_set_param(0, "overtake_dsp:" + key, value)`.
 *
 * So a test can drive the engine's own params — including the `ch<N>:` chain
 * namespace — without a device gesture:
 *
 *   engine-param.mjs set <key> <value> [host]
 *
 * e.g. engine-param.mjs set ch0:synth:module plaits
 *
 * WRITE ONLY. The socket has no `get_param` verb (remote_ui.go dispatches
 * subscribe / set_param / get_hierarchy / *_tool and nothing else), and
 * `subscribe_tool` seeds from `overtake_dsp:state`, which movy's engine does not
 * serve. Assert on movy's debug log instead — the engine logs each chain load.
 */

const PREFIX = 'overtake_dsp:';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(host) {
    return new Promise((res, rej) => {
        const ws = new WebSocket(`ws://${host}:7700/ws/remote-ui`);
        const to = setTimeout(() => rej(new Error('ws connect timeout')), 5000);
        ws.onopen = () => { clearTimeout(to); res(ws); };
        ws.onerror = (e) => { clearTimeout(to); rej(new Error('ws error: ' + (e?.message || e))); };
    });
}

async function main() {
    const mode = process.argv[2];
    if (mode !== 'set') {
        console.error('usage: engine-param.mjs set <key> <value> [host]   (write only — see header)');
        process.exit(2);
    }
    const key = process.argv[3];
    const value = process.argv[4];
    const host = process.argv[5] || process.env.HOST || 'move.local';
    if (!key || value === undefined) {
        console.error('missing key or value');
        process.exit(2);
    }
    const ws = await open(host);
    try {
        ws.send(JSON.stringify({ type: 'set_param', slot: 0, key: PREFIX + key, value }));
        await sleep(400);
    } finally {
        ws.close();
    }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
