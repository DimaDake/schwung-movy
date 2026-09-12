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
        /* An engine that ANSWERS with another version — what a store update
         * leaves behind, because the shim dlopens by path and glibc keeps
         * serving the library already loaded there until MoveOriginal
         * restarts. Distinct from silence: the UI can name the fix. */
        pingVersion: null,
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
        /* The engine's own Set store, MODELLED rather than echoed: `open` moves
         * the reported uuid only when the command actually arrives, so a test
         * that drops the write sees the status stay behind — which is the whole
         * safety argument for commands-instead-of-payloads. */
        setState: { uuid: '', phase: 'opening', gen: 0, dirty: 0 },
        setCmds: [],
        /* The version menu, the restored ui half and the sweep's verdict. All
         * three are strings the real engine's saver thread has already
         * published, so the mock serves them the same way: a field a test sets,
         * never something computed from what the UI just wrote. */
        versions: '',
        vui: 'none',
        gc: 'idle',
        /* Every other set_param, last value per key — the chain-set document
         * (`chains`) among them. RECORDED ONLY, never served back by
         * get_param: a mock that answered a key the real engine had not been
         * asked for would let a test assert on its own write. */
        params: {},

        reset() {
            this.cmdBatches = [];
            this.ops = [];
            this.status = { play: 0, tick: 0, bpm: 12000, trk: 0 };
            this.statusUnavailable = false;
            this.pingUnavailable = false;
            this.pingVersion = null;
            this.setParamCalls = 0;
            this.getParamCalls = 0;
            this.setState = { uuid: '', phase: 'opening', gen: 0, dirty: 0 };
            this.setCmds = [];
            this.versions = '';
            this.vui = 'none';
            this.gc = 'idle';
            this.loadRequests = [];
            this.alabels = null;
            this.stateLoads = [];
            this.stateBlob = null;
            this.params = {};
            this.trackClipLength = false;
        },
    };

    const setParam = (key, value) => {
        engine.setParamCalls++;
        /* The saver, modelled. Faithful on the one point the tests turn on: a
         * command that never arrives leaves `uuid` where it was, so the UI's
         * status comparison notices and re-sends. */
        if (key === 'set') {
            engine.setCmds.push(value);
            const [verb, a, b] = value.split(/\s+/);
            if (verb === 'open' && a) {
                engine.setState.uuid = a;
                engine.setState.phase = 'ready';
            } else if (verb === 'rename' && b) {
                engine.setState.uuid = b;
            } else if (verb === 'blank' && a) {
                engine.setState.uuid = a;
                engine.setState.phase = 'ready';
                engine.setState.gen = 0;
            } else if (verb === 'flush') {
                engine.setState.dirty = 0;
            }
            return true;
        }
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
        } else {
            engine.params[key] = value;
        }
        return true;
    };
    engine._setParam = setParam;
    installGlobals(engine);
    return engine;
}

/** Point the globals back at an engine that already exists.
 *
 *  For a suite that holds one engine for its whole run and needs the host
 *  functions back after `uninstallMockEngine()`. Calling `installMockEngine()`
 *  there instead builds a SECOND engine and wires the globals to it, silently
 *  detaching every later `engine.status.x = ...` from what the UI polls — and an
 *  assertion of the form "this change does not repaint" then passes because no
 *  change ever arrives. */
export function reinstallMockEngine(engine) {
    installGlobals(engine);
    return engine;
}

/* A chain-namespaced key (`ch3:synth:cutoff`) is a TRACK's param, not one of the
 * engine's own verbs. Every track is a movy chain now, so a model reading track
 * 3's synth arrives here — and an engine that answered null for it would leave
 * every param page blank in any suite that installs this mock. Handed back to
 * the ambient shadow mock (env.mjs), which is where those fixtures live. */
const CHAIN_KEY = /^ch([0-9]+):(.*)$/;

function installGlobals(engine) {
    const setParam = engine._setParam;
    const set = (key, value) => {
        /* Recorded by the engine AND mirrored to the slot store. Both matter:
         * suites assert on `eng.params['ch0:synth:state']` to see what the
         * engine was told, and a model reading the same track back has to find
         * it where the shadow fixtures live. */
        const recorded = setParam(key, value);
        if (!CHAIN_KEY.test(key)) return recorded;
        /* Handed to env.mjs's own chain writer rather than reimplemented: it
         * knows that `ch<N>:midi` is a note to be SENT, not a param to store,
         * and two copies of that rule would drift. */
        const put = globalThis.__movyEnvEngineSet;
        return put ? put(key, value) : recorded;
    };
    globalThis.host_module_set_param = set;
    globalThis.host_module_set_param_blocking = (key, value, _timeoutMs) => set(key, value);

    globalThis.host_module_get_param = (key) => {
        const m = CHAIN_KEY.exec(key);
        if (m) {
            /* The SLOT store answers, because that is where the fixtures live
             * and every chain write above is mirrored into it. `engine.params`
             * keeps its own copy for suites that assert on what the engine was
             * told, but it must not shadow a fixture it never saw. */
            const read = globalThis.shadow_get_param ?? globalThis.__movyEnvSlotGet;
            const v = read ? read(Number(m[1]), m[2]) : null;
            return v !== null ? v : (engine.params[key] ?? null);
        }
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
        if (key === 'ping') {
            if (engine.pingUnavailable) return null;
            return 'pong ' + (engine.pingVersion ?? ENGINE_VERSION);
        }
        if (key === 'set') {
            const st = engine.setState;
            return `uuid=${st.uuid} phase=${st.phase} gen=${st.gen} dirty=${st.dirty}`;
        }
        if (key === 'versions') return engine.versions;
        /* Taken once, exactly as the engine takes them: a verdict read twice
         * would let a test see a restore or a sweep that never happened. */
        if (key === 'vui') {
            const v = engine.vui;
            if (v !== 'pending') engine.vui = 'none';
            return v;
        }
        if (key === 'gc') {
            const v = engine.gc;
            if (v !== 'pending') engine.gc = 'idle';
            return v;
        }
        if (key === 'alabels') return engine.alabels;
        if (key === 'state') return engine.stateBlob;
        return null;
    };
}

export function uninstallMockEngine() {
    /* Restored, not deleted. Every track is a movy chain, so its params are read
     * through these — a suite that removed them left every later suite's param
     * pages blank. env.mjs installs the ambient pair at import. */
    if (globalThis.__movyEnvEngineGet) {
        globalThis.host_module_get_param = globalThis.__movyEnvEngineGet;
        globalThis.host_module_set_param = globalThis.__movyEnvEngineSet;
        globalThis.host_module_set_param_blocking = globalThis.__movyEnvEngineSet;
        return;
    }
    delete globalThis.host_module_set_param;
    delete globalThis.host_module_set_param_blocking;
    delete globalThis.host_module_get_param;
}
