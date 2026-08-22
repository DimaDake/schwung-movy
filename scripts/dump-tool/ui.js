/* movy-dump — on-device module inventory collector.
 *
 * Deployed temporarily by scripts/dump-modules.sh OVER movy's own ui.js
 * (the shadow UI caches its tool list, so a new tool dir would be invisible
 * to open_tool_cmd; movy's registration is reused instead and the real ui.js
 * is restored afterwards). For every module installed
 * under modules/{midi_fx,sound_generators,audio_fx} it:
 *   1. loads the module into the focused track's matching chain slot
 *      (shadow_set_param ck:module — the same call movy's browser makes),
 *   2. waits for the DSP to come up (read-back matches + hierarchy appears),
 *   3. captures module.json, movy_config.json, live ui_hierarchy, live
 *      chain_params, every param's current value, and preset names,
 *   4. appends to /data/UserData/schwung/movy-module-dump.json (rewritten
 *      after each module so a crash loses at most one entry).
 * The original chain modules are restored at the end.
 *
 * No font dependency: progress is a bare fill_rect bar. All logic runs from
 * tick(); each state transition is time-based (device tick rate varies).
 */

/* `os` is a QuickJS module, not a global — same import movy's bundle uses. */
import * as os from 'os';

const BASE = '/data/UserData/schwung/modules';
const OUT  = '/data/UserData/schwung/movy-module-dump.json';

const CATS = [
    { dir: 'midi_fx',          type: 'midi_fx',         ck: 'midi_fx1' },
    { dir: 'sound_generators', type: 'sound_generator', ck: 'synth'    },
    { dir: 'audio_fx',         type: 'audio_fx',        ck: 'fx1'      },
];

/* Track components read the loaded id back via the underscore alias. */
function readKey(ck) { return ck + '_module'; }

const LOAD_TIMEOUT_MS = 12000;  // give heavy synths (dexed, surge, sf2) time
const SETTLE_MS       = 2500;   // read-back ok but no hierarchy → capture anyway
const GRACE_MS        = 500;    // hierarchy seen → let chain_params catch up
const MAX_VALUE_KEYS  = 400;    // per-module value snapshot cap
const MAX_PRESETS     = 300;    // preset-name cap (sf2 banks can be huge)

let slot = 0;
let queue = [];          // [{cat, id, dirName, moduleJson, movyConfig, dspSize}]
let originals = {};      // ck → original module id ('' = empty)
let results = [];
let state = 'scan';
let idx = -1;
let tStart = 0, tReady = 0, tHier = 0;
let lastPoll = 0;
let dump = null;

function log(m) { console.log('[movy-dump] ' + m); }

function readJson(path) {
    try {
        const raw = host_read_file(path);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function fileSize(path) {
    try {
        const [st, err] = os.stat(path);
        return err === 0 && st ? (st.size || 0) : 0;
    } catch (e) { return 0; }
}

function get(key) { return shadow_get_param(slot, key); }

function scan() {
    slot = (typeof shadow_get_ui_slot === 'function' ? shadow_get_ui_slot() : 0) || 0;
    for (const cat of CATS) {
        originals[cat.ck] = get(readKey(cat.ck)) || '';
        let entries = [];
        try { entries = os.readdir(BASE + '/' + cat.dir)[0] || []; } catch (e) {}
        entries.sort();
        for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;
            const dir = BASE + '/' + cat.dir + '/' + entry;
            const mj = readJson(dir + '/module.json');
            if (!mj) continue;
            const ct = mj.component_type || (mj.capabilities && mj.capabilities.component_type);
            if (ct !== cat.type) continue;
            queue.push({
                cat, dirName: entry,
                id: mj.id || entry,
                moduleJson: mj,
                movyConfig: readJson(dir + '/movy_config.json'),
                dspSize: fileSize(dir + '/' + (mj.dsp || 'dsp.so')),
            });
        }
    }
    dump = {
        generated_at: new Date().toISOString(),
        device_slot: slot,
        schwung_release: readJson('/data/UserData/schwung/release.json'),
        originals,
        module_count: queue.length,
        complete: false,
        modules: results,
    };
    log('scan: ' + queue.length + ' modules, slot ' + slot +
        ', originals ' + JSON.stringify(originals));
}

function save(complete) {
    dump.complete = !!complete;
    try { host_write_file(OUT, JSON.stringify(dump)); }
    catch (e) { log('write failed: ' + e); }
}

/* Snapshot every raw param string movy (or the shadow UI) would read for this
 * module, keyed WITHOUT the component prefix so offline tooling can replay it
 * under any componentKey. */
function capture(mod, status) {
    const ck = mod.cat.ck;
    const params = {};
    const grab = (k) => {
        if (params[k] !== undefined) return params[k];
        const v = get(ck + ':' + k);
        if (v !== null) params[k] = v;
        return v;
    };

    const hierRaw = grab('ui_hierarchy');
    const cpRaw   = grab('chain_params');
    grab('name');

    let hier = null, cp = null;
    try { hier = hierRaw ? JSON.parse(hierRaw) : null; } catch (e) { params.__hier_parse_error = String(e); }
    try { cp   = cpRaw   ? JSON.parse(cpRaw)   : null; } catch (e) { params.__cp_parse_error   = String(e); }

    /* Current value of every chain_params key = the module's defaults. */
    let valueKeys = 0;
    if (Array.isArray(cp)) {
        for (const p of cp) {
            if (!p || !p.key || valueKeys >= MAX_VALUE_KEYS) continue;
            grab(p.key);
            valueKeys++;
        }
    }

    /* Item-selector levels (items_param/select_param): dexed banks, sf2
     * soundfonts, nam models/cabs. Neither key appears in chain_params, so
     * without this the dump records the level and none of its contents — and a
     * dump-replay assertion on the selector cell would have nothing to build
     * from. See plans/2026-08-22-item-selector-design.md. */
    if (hier && hier.levels) {
        for (const lvl of Object.values(hier.levels)) {
            if (!lvl || !lvl.items_param) continue;
            grab(lvl.items_param);
            if (lvl.select_param) grab(lvl.select_param);
        }
    }

    /* Preset inventory, when the hierarchy declares one. */
    let presets = null;
    const root = hier && hier.levels && (hier.levels.root || Object.values(hier.levels)[0]);
    if (root && root.list_param && root.count_param) {
        const count = parseInt(grab(root.count_param) || '0', 10) || 0;
        presets = { list_param: root.list_param, count_param: root.count_param,
                    name_param: root.name_param || null, count, names: null };
        if (count > 0) {
            const namesRaw = grab('preset_names');
            if (namesRaw) {
                try {
                    const all = JSON.parse(namesRaw);
                    presets.names = all.slice(0, MAX_PRESETS);
                    presets.names_truncated = all.length > MAX_PRESETS;
                } catch (e) {}
            }
            if (!presets.names && get(ck + ':preset_name_0') !== null) {
                presets.names = [];
                const n = Math.min(count, MAX_PRESETS);
                for (let i = 0; i < n; i++) {
                    presets.names.push(get(ck + ':preset_name_' + i) || String(i));
                }
                presets.names_truncated = count > n;
            }
        }
    }

    results.push({
        id: mod.id,
        dir: mod.dirName,
        category: mod.cat.type,
        component_key: ck,
        status,
        load_ms: (tReady || Date.now()) - tStart,
        dsp_size: mod.dspSize,
        module_json: mod.moduleJson,
        movy_config: mod.movyConfig,
        ui_hierarchy: hier,
        chain_params: cp,
        presets,
        params,
    });
    log((idx + 1) + '/' + queue.length + ' ' + mod.id + ' → ' + status +
        (hier ? ' (hier)' : '') + (cp ? ' (cp ' + (cp.length || 0) + ')' : ''));
    save(false);
}

function drawProgress() {
    clear_screen();
    const total = Math.max(1, queue.length);
    const done  = Math.max(0, idx);
    fill_rect(4, 28, 120, 8, 0);
    fill_rect(4, 28, Math.round(120 * done / total), 8, 1);
    /* State LED: blinks while waiting on a module load. */
    const on = state === 'wait' && (Math.floor(Date.now() / 250) % 2 === 0);
    fill_rect(4, 44, 4, 4, on ? 1 : 0);
}

function step() {
    const now = Date.now();

    if (state === 'scan') {
        scan();
        save(false);
        state = queue.length > 0 ? 'next' : 'restore';
        return;
    }

    if (state === 'next') {
        idx++;
        if (idx >= queue.length) { state = 'restore'; return; }
        const mod = queue[idx];
        tStart = now; tReady = 0; tHier = 0;
        shadow_set_param(slot, mod.cat.ck + ':module', mod.id);
        state = 'wait';
        return;
    }

    if (state === 'wait') {
        const mod = queue[idx];
        const back = get(readKey(mod.cat.ck));
        if (back === mod.id) {
            if (!tReady) tReady = now;
            const hasData = get(mod.cat.ck + ':ui_hierarchy') !== null ||
                            get(mod.cat.ck + ':chain_params') !== null;
            if (hasData && !tHier) tHier = now;
            if ((tHier && now - tHier >= GRACE_MS) ||
                (!tHier && now - tReady >= SETTLE_MS)) {
                capture(mod, tHier ? 'ok' : 'ok_no_hierarchy');
                state = 'next';
            }
        } else if (now - tStart >= LOAD_TIMEOUT_MS) {
            capture(mod, 'load_timeout');
            state = 'next';
        }
        return;
    }

    if (state === 'restore') {
        for (const cat of CATS) {
            shadow_set_param(slot, cat.ck + ':module', originals[cat.ck] || '');
        }
        tStart = now;
        state = 'finish';
        return;
    }

    if (state === 'finish') {
        if (now - tStart < 1500) return;  // let the restored modules settle
        save(true);
        log('DONE — ' + results.length + ' modules dumped to ' + OUT);
        state = 'exit';
        host_exit_module();
        return;
    }
}

globalThis.init = function () {
    log('init');
};

let tickN = 0;
globalThis.tick = function () {
    tickN++;
    if (tickN % 10 !== 0) return;   // ~20 Hz is plenty for SHM polling
    try { step(); } catch (e) {
        log('step error in state ' + state + ': ' + e + (e && e.stack ? '\n' + e.stack : ''));
        /* Skip the offending module rather than wedging the run. */
        if (state === 'wait') { state = 'next'; } else { state = 'restore'; }
    }
    drawProgress();
};

globalThis.onMidiMessageInternal = function (_data) { /* ignore all input */ };
globalThis.onMidiMessageExternal = function (_data) { /* ignore all input */ };
