/* Mock of the Rust engine's param protocol for browser/node tests. Installs
 * host_module_set_param / host_module_get_param and movy-host's status
 * snapshot (movy_engine_snapshot*, movy_engine_submitted) on globalThis and
 * implements the same cmd/status contract as movy-dsp, so src/seq/engine.ts is
 * tested against the real wire format. */

import { ENGINE_VERSION } from '../dist/esm/seq/constants.js';
import { parseState } from '../dist/esm/seq/persist-blob.js';
import { uuidToStatePath } from '../dist/esm/seq/set-context.js';

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
        /* Set true to simulate a DSP that did not load: `ping` answers nothing
         * and no snapshot is ever published. */
        pingUnavailable: false,
        /* An engine that ANSWERS with another version: a dsp.so from a
         * different build than this ui.js. */
        pingVersion: null,
        setParamCalls: 0,
        getParamCalls: 0,
        /* movy-host's queue, modelled: every request counts as submitted, and
         * the mock applies it at once, so a snapshot is stamped with all of
         * them — unless a test holds `served` back to model a status taken
         * before its requests reached the engine. */
        submitted: 0,
        holdServed: null,
        /* Snapshots published so far: one per ask, like an audio thread that
         * renders more often than the UI ticks. */
        snapSeq: 0,
        /* Opt-in: model seq-core's clip-length behaviour so `len=` comes back in
         * status the way the real engine reports it — a note written outside the
         * current window rounds the clip up to that step's BAR end
         * (Clip::extend_to_step), while `clen` sets an exact step count. Off by
         * default: most tests set seqState.lenSteps by hand and a poll reporting
         * a length would fight them. */
        trackClipLength: false,
        /* Consecutive `watch` ops to accept-but-not-apply: the op is recorded
         * in `ops` (the UI genuinely sent it) but `status.trk` is left alone,
         * modelling the single-slot `overtake_dsp` SHM's "observer effect"
         * (docs/persistence-hazards.md #1) — a write made while a Set is
         * restoring can be silently overwritten before the engine core ever
         * reads it, which looks like this from the UI's side, not like a
         * write that never happened. */
        dropWatchCount: 0,
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
        /* movy's Set library (set_lib_jobs.rs), which is where a session's
         * identity comes from: one Set, open, unless a test says otherwise.
         * `lib` answers in the engine's wire format; `set lib new` adds a Set. */
        lib: { rev: 1, cur: 'S1', made: '', err: '', sets: [{ id: 'S1', name: 'Song One', clips: 0 }] },
        /* Every other set_param, last value per key — the chain-set document
         * (`chains`) among them. RECORDED ONLY, never served back by
         * get_param: a mock that answered a key the real engine had not been
         * asked for would let a test assert on its own write. */
        params: {},

        reset() {
            this.cmdBatches = [];
            this.ops = [];
            this.status = { play: 0, tick: 0, bpm: 12000, trk: 0 };
            this.pingUnavailable = false;
            this.pingVersion = null;
            this.setParamCalls = 0;
            this.getParamCalls = 0;
            this.submitted = 0;
            this.holdServed = null;
            this.snapSeq = 0;
            this.setState = { uuid: '', phase: 'opening', gen: 0, dirty: 0 };
            this.setCmds = [];
            this.versions = '';
            this.vui = 'none';
            this.gc = 'idle';
            this.lib = { rev: 1, cur: 'S1', made: '', err: '', sets: [{ id: 'S1', name: 'Song One', clips: 0 }] };
            this.alabels = null;
            this.stateLoads = [];
            this.stateBlob = null;
            this.params = {};
            this.trackClipLength = false;
            this.dropWatchCount = 0;
        },
    };

    const setParam = (key, value) => {
        engine.setParamCalls++;
        /* The saver, modelled. Faithful on the one point the tests turn on: a
         * command that never arrives leaves `uuid` where it was, so the UI's
         * status comparison notices and re-sends. */
        if (key === 'set') {
            engine.setCmds.push(value);
            if (value.startsWith('lib ')) {
                const [verb, ...rest] = value.slice(4).split(' ');
                const lib = engine.lib;
                if (verb === 'new') {
                    lib.made = 'M' + (lib.sets.length + 1);
                    lib.sets.unshift({ id: lib.made, name: rest.join(' '), clips: 0 });
                } else if (verb === 'del') {
                    lib.sets = lib.sets.filter((x) => x.id !== rest[0]);
                }
                lib.rev++;
                return true;
            }
            const [verb, a, b] = value.split(/\s+/);
            if (verb === 'open' && a) {
                engine.setState.uuid = a;
                engine.setState.phase = 'ready';
                /* The saver's verdict on the files, as `sbad` (set_saver.rs
                 * do_open): files that exist but do not parse are named, never
                 * read as an empty Set. */
                const raw = globalThis.host_read_file ? globalThis.host_read_file(uuidToStatePath(a)) : null;
                engine.status.sbad = raw != null && parseState(raw) === null ? a : '-';
            } else if (verb === 'rename' && b) {
                engine.setState.uuid = b;
            } else if (verb === 'blank' && a) {
                engine.status.sbad = '-';
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
                else if (verb === 'watch') {
                    if (engine.dropWatchCount > 0) engine.dropWatchCount--;
                    else engine.status.trk = +parts[1];
                }
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
/* The engine-root components — movy's master chain and the send buses — carry
 * their own namespace and no `ch<N>:`, but their fixtures live in the same
 * slot store (slot 0, full key), so they are mirrored the same way. */
const ROOT_KEY = /^(mfx:|snd[0-9]:)/;

function installGlobals(engine) {
    const setParam = engine._setParam;
    const set = (key, value) => {
        /* Recorded by the engine AND mirrored to the slot store. Both matter:
         * suites assert on `eng.params['ch0:synth:state']` to see what the
         * engine was told, and a model reading the same track back has to find
         * it where the shadow fixtures live. */
        const recorded = setParam(key, value);
        if (!CHAIN_KEY.test(key) && !ROOT_KEY.test(key)) return recorded;
        /* Handed to env.mjs's own chain writer rather than reimplemented: it
         * knows that `ch<N>:midi` is a note to be SENT, not a param to store,
         * and two copies of that rule would drift. */
        const put = globalThis.__movyEnvEngineSet;
        return put ? put(key, value) : recorded;
    };
    globalThis.host_module_set_param = (key, value) => { engine.submitted++; return set(key, value); };
    /* schwung's name for a set that waits; the shared JS may call it. */
    globalThis.host_module_set_param_blocking = (key, value) => globalThis.host_module_set_param(key, value);
    const statusText = () => Object.entries(engine.status).map(([k, v]) => `${k}=${v}`).join(' ');
    globalThis.movy_engine_snapshot_seq = () => (engine.pingUnavailable ? 0 : ++engine.snapSeq);
    globalThis.movy_engine_snapshot = () => (engine.pingUnavailable ? null : {
        seq: engine.snapSeq,
        served: engine.holdServed ?? engine.submitted,
        text: statusText(),
    });
    globalThis.movy_engine_submitted = () => engine.submitted;

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
        if (ROOT_KEY.test(key)) {
            const read = globalThis.shadow_get_param ?? globalThis.__movyEnvSlotGet;
            const v = read ? read(0, key) : null;
            if (v !== null && v !== undefined) return v;
            if (key in engine.params) return engine.params[key];
        }
        engine.getParamCalls++;
        engine.submitted++;
        /* Every key in engine.status (play/tick/bpm by default, plus any a test
         * adds — act=, occ=, …), in the real engine's wire format. The UI reads
         * it from the snapshot; a direct get still answers, as movy-dsp does. */
        if (key === 'status') return statusText();
        if (key === 'ping') {
            if (engine.pingUnavailable) return null;
            return 'pong ' + (engine.pingVersion ?? ENGINE_VERSION);
        }
        if (key === 'set') {
            const st = engine.setState;
            return `uuid=${st.uuid} phase=${st.phase} gen=${st.gen} dirty=${st.dirty}`;
        }
        if (key === 'versions') return engine.versions;
        if (key === 'lib') {
            const l = engine.lib;
            return `rev=${l.rev} cur=${l.cur || '-'} made=${l.made || '-'} err=${l.err || '-'}\n`
                + l.sets.map((x) => `${x.id}\t${x.clips}\t0\t${x.name}\n`).join('');
        }
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
        if (key === 'notes') { engine.notesGets = (engine.notesGets ?? 0) + 1; return engine.notes ?? ''; }
        if (key === 'state') return engine.stateBlob;
        /* AI MIDI's per-track clip dump (engine/ai_clip.rs): '' = no clips. */
        if (key.startsWith('ait:')) return engine.params[key] ?? '';
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
        globalThis.__movyEnvInstallSnapshot?.();
        return;
    }
    delete globalThis.host_module_set_param;
    delete globalThis.host_module_set_param_blocking;
    delete globalThis.host_module_get_param;
    delete globalThis.movy_engine_snapshot_seq;
    delete globalThis.movy_engine_snapshot;
    delete globalThis.movy_engine_submitted;
}
