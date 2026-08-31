import { componentPort } from '../track/registry.js';
import { browserState } from './state.js';
import { appState, VIEW_BROWSE } from '../app/state.js';
import { moduleReadKey, type ChainSlot } from '../chain/config.js';
import { requestLaneWarm } from '../seq/automation.js';
import { releaseAllLive } from '../keyboard/release.js';
import { captureLfoAssignments, captureModuleState, dumpModuleParams } from '../undo/module-dump.js';
import { mlog } from '../log.js';
import { addModuleOp, beginEdit, endEdit, CLOSE } from '../undo/group.js';
import { syncMasterFxMirror } from '../chain/master-mirror.js';

const MODULES_BASE = '/data/UserData/schwung/modules';

/* How long to wait for the shim to finish loading a master FX module before
 * reading it back. dlopen + init + create_instance, measured worst case on a
 * CLAP host; the shim's own default is 100 ms, which a module load overruns. */
const MASTER_LOAD_TIMEOUT_MS = 3000;

function scanModules(slot: ChainSlot): { id: string; name: string; path: string }[] {
    const dir    = `${MODULES_BASE}/${slot.scanDir}`;
    const result: { id: string; name: string; path: string }[] = [];
    try {
        const [entries] = os.readdir(dir) as [string[], number];
        if (!Array.isArray(entries)) return result;
        for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;
            try {
                const raw = host_read_file(`${dir}/${entry}/module.json`);
                if (!raw) continue;
                const json = JSON.parse(raw) as {
                    id?: string; name?: string; dsp?: string;
                    component_type?: string;
                    capabilities?: { component_type?: string };
                };
                const ct = json.component_type || json.capabilities?.component_type;
                if (ct === slot.expectedType) {
                    // Master FX slots load by DSP path (see loadSelectedModule); track
                    // slots load by id. Capture both so either can be written.
                    const path = `${dir}/${entry}/${json.dsp || 'dsp.so'}`;
                    result.push({ id: json.id || entry, name: json.name || entry, path });
                }
            } catch {}
        }
    } catch {}
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

/* Open the module browser for a chain slot.
 *
 * `paramSlot` is a TRACK INDEX (0-15), not a schwung slot — it stopped being a
 * slot number when movy started hosting its own chains, and the name is kept
 * only because it is also the key undo records module ops under. Everything
 * here reaches the track through `componentPort`, so a movy-hosted track browses
 * and loads exactly like a host one; the write lands as `ch<N>:<component>:module`
 * instead of a shadow-slot param. The master bus passes 0 — and its `master_fx:`
 * keys are schwung's own, so `componentPort` keeps them on a shadow slot however
 * `chtracks` has resolved track 0.
 *
 * `reload` refreshes the model backing this slot after a load. Generalized over
 * CHAIN_SLOTS and MASTER_FX_SLOTS so master FX slots browse/load like track
 * slots. */
export function openBrowser(slot: ChainSlot, paramSlot: number, reload: () => void): void {
    browserState.componentKey = slot.componentKey;
    browserState.paramSlot    = paramSlot;
    browserState.reload       = reload;
    browserState.modules      = [{ id: '', name: 'NONE', path: '' }, ...scanModules(slot)];
    browserState.browseIndex  = 0;
    const activeId = componentPort(paramSlot, slot.componentKey)
        .getParam(moduleReadKey(slot.componentKey)) || '';
    const idx = browserState.modules.findIndex(m => m.id === activeId);
    if (idx >= 0) browserState.browseIndex = idx;
    /* The only trace the browser leaves. Without it a device test cannot tell
     * "the gesture never reached the browser" from "the browser refused the
     * load" — the two failures look identical from the log. */
    mlog('browse: open t=' + paramSlot + ' ' + slot.componentKey
        + ' n=' + browserState.modules.length);
    appState.currentView = VIEW_BROWSE;
    appState.dirty = true;
}

export function loadSelectedModule(): void {
    if (browserState.modules.length === 0) return;
    const mod = browserState.modules[browserState.browseIndex];
    // Track chain slots load a module by its id (`fx1:module` = "reverb"); master
    // FX slots (colon-namespaced componentKey, e.g. `master_fx:fx1`) instead take
    // the full DSP path — schwung's master bus resolves `master_fx:fxN:module`
    // as a path, not an id, so writing the id silently no-ops.
    const isMaster = browserState.componentKey.includes(':');
    const value    = isMaster ? mod.path : mod.id;
    // The outgoing module is about to be torn down; its notes must be released
    // while it is still there to receive the off.
    releaseAllLive();
    /* Dump BEFORE the write: schwung tears the outgoing module down, and after
     * that its params are unrecoverable. A reselect of the same module records
     * nothing — it changes no state worth an undo press. */
    const prevId = componentPort(browserState.paramSlot, browserState.componentKey)
        .getParam(moduleReadKey(browserState.componentKey)) || '';
    /* Compare identities, not the written value: for a master slot `value` is a
     * path while `prevId` is an id, so comparing them called every reselect a
     * change. */
    const prev = browserState.modules.find((m) => m.id === prevId);
    const changed = prevId !== mod.id;
    if (changed) {
        /* Prefer schwung's own whole-module blob; the per-param dump is the
         * fallback for modules that expose none. Skipping the dump when the
         * blob works also spares a module swap ~100 blocking param reads. */
        const state = captureModuleState(browserState.paramSlot, browserState.componentKey);
        const dump = state === null
            ? dumpModuleParams(browserState.paramSlot, browserState.componentKey)
            : { params: [] as [string, string][], leadCount: 0 };
        if (state !== null) mlog('undo: captured module state (' + state.length + ' bytes)');
        beginEdit({
            key: 'module:' + browserState.paramSlot + ':' + browserState.componentKey,
            verb: value ? 'LOAD MODULE' : 'CLEAR SLOT',
            target: 'T' + (browserState.paramSlot + 1),
            detail: (mod.name || value || 'NONE').toUpperCase(),
            close: CLOSE.IMMEDIATE, seq: true,
        });
        const ids = (id: string, path: string) => [id, path].filter((v) => v !== '');
        addModuleOp({
            slot: browserState.paramSlot,
            componentKey: browserState.componentKey,
            /* Restoring must write what THIS slot kind loads by — an id for a
             * track chain slot, a DSP path for master FX. Writing the wrong one
             * silently no-ops (see the isMaster comment above). */
            oldWrite: isMaster ? (prev?.path ?? '') : prevId,
            newWrite: value,
            oldIds: ids(prevId, prev?.path ?? ''),
            newIds: ids(mod.id, mod.path),
            oldLfo: captureLfoAssignments(browserState.paramSlot, browserState.componentKey),
            oldState: state ?? undefined,
            oldParams: dump.params,
            leadCount: dump.leadCount,
        });
    }
    const port = componentPort(browserState.paramSlot, browserState.componentKey);
    if (isMaster) {
        /* Blocking, unlike the track path: the mirror resync below immediately
         * reads back what the shim loaded, and a plain set is fire-and-forget
         * under overtake — the read then finds the slot still empty and the
         * resync writes emptiness back, which is the very bug it exists to fix.
         * The wait covers a dlopen plus module init (a CLAP host is the slow
         * case), so it is far longer than the 100 ms default. */
        port.setParamTimeout(browserState.componentKey + ':module', value, MASTER_LOAD_TIMEOUT_MS);
        /* The shim now holds the module, but schwung persists the master chain
         * from a mirror that did not see this write and would erase the slot on
         * save. Temporary — see chain/master-mirror.ts for the removal condition. */
        syncMasterFxMirror();
    } else {
        port.setParam(browserState.componentKey + ':module', value);
    }
    if (changed) endEdit();
    // The reload empties the host's static param cache; a same-id reselect won't
    // trip the module-name watcher, so schedule the warm here too (see
    // warmLaneParams) — without it, abs-CC automation is inaudible until restart.
    requestLaneWarm(browserState.paramSlot);
    appState.currentView = appState.browseOrigin;
    appState.dirty = true;
    browserState.reload?.();
}
