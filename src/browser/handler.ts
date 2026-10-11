import { componentPort } from '../track/registry.js';
import { browserState } from './state.js';
import { appState, VIEW_BROWSE, VIEW_CHAIN } from '../app/state.js';
import { moduleReadKey, MASTER_FX_SLOTS, type ChainSlot } from '../chain/config.js';
import { releaseAllLive } from '../keyboard/release.js';
import { captureLfoAssignments, captureModuleState, dumpModuleParams } from '../undo/module-dump.js';
import { mlog } from '../log.js';
import { addModuleOp, beginEdit, endEdit, CLOSE } from '../undo/group.js';
import { platform } from '../platform/index.js';

const MODULES_BASE = '/data/UserData/schwung/modules';

function scanModules(slot: ChainSlot): { id: string; name: string }[] {
    const dir    = `${MODULES_BASE}/${slot.scanDir}`;
    const result: { id: string; name: string }[] = [];
    try {
        const [entries] = os.readdir(dir) as [string[], number];
        if (!Array.isArray(entries)) return result;
        for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;
            try {
                const raw = platform.readFile(`${dir}/${entry}/module.json`);
                if (!raw) continue;
                const json = JSON.parse(raw) as {
                    id?: string; name?: string;
                    component_type?: string;
                    capabilities?: { component_type?: string };
                };
                const ct = json.component_type || json.capabilities?.component_type;
                if (ct === slot.expectedType) {
                    result.push({ id: json.id || entry, name: json.name || entry });
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
 * instead of a shadow-slot param. The master bus passes 0 — and its `mfx:`
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
    browserState.modules      = [{ id: '', name: 'NONE' }, ...scanModules(slot)];
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
    // Every slot loads a module by its id (`fx1:module` = "reverb").
    const value = mod.id;
    // The outgoing module is about to be torn down; its notes must be released
    // while it is still there to receive the off.
    releaseAllLive();
    /* Dump BEFORE the write: schwung tears the outgoing module down, and after
     * that its params are unrecoverable. A reselect of the same module records
     * nothing — it changes no state worth an undo press. */
    const prevId = componentPort(browserState.paramSlot, browserState.componentKey)
        .getParam(moduleReadKey(browserState.componentKey)) || '';
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
        const ids = (id: string) => (id === '' ? [] : [id]);
        addModuleOp({
            slot: browserState.paramSlot,
            componentKey: browserState.componentKey,
            oldWrite: prevId,
            newWrite: value,
            oldIds: ids(prevId),
            newIds: ids(mod.id),
            oldLfo: captureLfoAssignments(browserState.paramSlot, browserState.componentKey),
            oldState: state ?? undefined,
            oldParams: dump.params,
            leadCount: dump.leadCount,
        });
    }
    componentPort(browserState.paramSlot, browserState.componentKey)
        .setParam(browserState.componentKey + ':module', value);
    if (changed) endEdit();
    /* NONE leaves nothing for a module page to show, so it lands on the chain
     * view whichever page opened the browser. Returning to the origin put the
     * user back on the knob page of a slot that no longer has a module — and
     * under Schwung pages that page kept drawing the removed module's params,
     * because only the chain view checks for an empty slot before the body. */
    if (value === '') {
        appState.currentView = VIEW_CHAIN;
        /* By PAGE, not by component: the send buses share the master page and
         * its detail drill but are not `mfx:` components. */
        if (MASTER_FX_SLOTS.some((s) => s.componentKey === browserState.componentKey)) {
            appState.masterDetail = false;
        }
    } else {
        appState.currentView = appState.browseOrigin;
    }
    appState.dirty = true;
    browserState.reload?.();
}
