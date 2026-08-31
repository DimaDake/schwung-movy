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
        /* status the engine reports; tests mutate freely. `trk` is here
         * because the real engine ALWAYS reports its watched track — a mock
         * that omitted it let a UI-only watch retarget look like it worked,
         * when on device the next poll pins the field straight back. */
        status: { play: 0, tick: 0, bpm: 12000, trk: 0 },
        /* set true to simulate an engine that lacks the protocol */
        statusUnavailable: false,
        /* Set true to simulate a DSP that never loads: the UI probes `ping`
         * until it gives up and declares the engine absent. */
        pingUnavailable: false,
        setParamCalls: 0,
        getParamCalls: 0,
        /* DSP (re)load requests ("load" key, shim-handled on device) */
        loadRequests: [],
        /* Opt-in: model seq-core's clip-length behaviour so `len=` comes back in
         * status the way the real engine reports it — a note written outside the
         * current window rounds the clip up to that step's BAR end
         * (Clip::extend_to_step), while `clen` sets an exact step count. Off by
         * default: most tests set seqState.lenSteps by hand and a poll reporting
         * a length would fight them. */
        trackClipLength: false,
        /* persisted automation lane labels reported via get_param('alabels');
         * an `aclr <t> <l>` op blanks the matching lane (faithful engine). */
        alabels: null,
        /* blocking `state` loads, in order; stateBlob = last loaded blob */
        stateLoads: [],
        stateBlob: null,

        reset() {
            this.cmdBatches = [];
            this.ops = [];
            this.status = { play: 0, tick: 0, bpm: 12000, trk: 0 };
            this.statusUnavailable = false;
            this.pingUnavailable = false;
            this.setParamCalls = 0;
            this.getParamCalls = 0;
            this.loadRequests = [];
            this.alabels = null;
            this.stateLoads = [];
            this.stateBlob = null;
            this.trackClipLength = false;
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
                // Applied so the status poll confirms a tempo edit instead of
                // reverting it — that round trip is what proves a knob turn
                // actually reached the engine, not just the UI mirror.
                else if (verb === 'bpm') engine.status.bpm = +parts[1];
                else if (verb === 'watch') engine.status.trk = +parts[1];
                else if (engine.trackClipLength && (verb === 'addp' || verb === 'clen')) {
                    const cur = engine.status.len ?? 0;
                    if (verb === 'clen') {
                        engine.status.len = +parts[2];
                    } else {
                        // addp <t> <s0> <s1> <pitch> <vel> — a note at or past the
                        // window end grows the clip to that step's bar end.
                        const step = +parts[3];
                        if (step >= cur) engine.status.len = (Math.floor(step / 16) + 1) * 16;
                    }
                }
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
        if (key === 'ping') return engine.pingUnavailable ? null : 'pong ' + ENGINE_VERSION;
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
