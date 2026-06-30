/* Mock of the Rust engine's param protocol for browser/node tests. Installs
 * host_module_set_param / host_module_get_param on globalThis and implements
 * the same cmd/status contract as movy-dsp, so src/seq/engine.ts is tested
 * against the real wire format. */

import { ENGINE_VERSION } from '../dist/esm/seq/constants.js';

export function installMockEngine() {
    const engine = {
        /* every batched cmd flush, in arrival order */
        cmdBatches: [],
        /* parsed individual ops across all batches */
        ops: [],
        /* status the engine reports; tests mutate freely */
        status: { play: 0, tick: 0, bpm: 12000 },
        /* set true to simulate an engine that lacks the protocol */
        statusUnavailable: false,
        setParamCalls: 0,
        getParamCalls: 0,
        /* DSP (re)load requests ("load" key, shim-handled on device) */
        loadRequests: [],
        /* persisted automation lane labels reported via get_param('alabels');
         * an `aclr <t> <l>` op blanks the matching lane (faithful engine). */
        alabels: null,
        /* blocking `state` loads, in order; stateBlob = last loaded blob */
        stateLoads: [],
        stateBlob: null,

        reset() {
            this.cmdBatches = [];
            this.ops = [];
            this.status = { play: 0, tick: 0, bpm: 12000 };
            this.statusUnavailable = false;
            this.setParamCalls = 0;
            this.getParamCalls = 0;
            this.loadRequests = [];
            this.alabels = null;
            this.stateLoads = [];
            this.stateBlob = null;
        },
    };

    const setParam = (key, value) => {
        engine.setParamCalls++;
        if (key === 'cmd') {
            engine.cmdBatches.push(value);
            for (const op of value.split(';')) {
                if (op.length === 0) continue;
                engine.ops.push(op);
                /* Apply transport ops to status so a subsequent poll agrees
                 * with the UI's optimistic mirror (faithful-engine behavior:
                 * the engine reports back what the command set). */
                const parts = op.split(' ');
                const verb = parts[0];
                if (verb === 'play') engine.status.play = 1;
                else if (verb === 'stop') engine.status.play = 0;
                else if (verb === 'aclr' && engine.alabels) {
                    // Blank the cleared lane so a re-poll reflects the purge.
                    const t = +parts[1], l = +parts[2];
                    const tracks = engine.alabels.split(',');
                    if (tracks[t]) {
                        const lanes = tracks[t].split('.');
                        lanes[l] = '-';
                        tracks[t] = lanes.join('.');
                        engine.alabels = tracks.join(',');
                    }
                }
            }
        } else if (key === 'load') {
            engine.loadRequests.push(value);
        } else if (key === 'state') {
            engine.stateLoads.push(value);
            engine.stateBlob = value;
        }
        return true;
    };
    globalThis.host_module_set_param = setParam;
    globalThis.host_module_set_param_blocking = (key, value, _timeoutMs) => setParam(key, value);

    globalThis.host_module_get_param = (key) => {
        engine.getParamCalls++;
        if (key === 'status') {
            if (engine.statusUnavailable) return null;
            /* Serialize every key in engine.status (play/tick/bpm by default,
             * plus any a test adds — act=, occ=, …) so the wire format matches
             * the real engine and tests can inject arbitrary status. */
            return Object.entries(engine.status)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ');
        }
        if (key === 'ping') return 'pong ' + ENGINE_VERSION;
        if (key === 'alabels') return engine.alabels;
        if (key === 'state') return engine.stateBlob;
        return null;
    };

    return engine;
}

export function uninstallMockEngine() {
    delete globalThis.host_module_set_param;
    delete globalThis.host_module_set_param_blocking;
    delete globalThis.host_module_get_param;
}
