/* HACK — remove when schwung's upstream fix lands. See REMOVAL below.
 *
 * Schwung persists the master FX chain from a JS-side mirror inside
 * shadow_ui.js (`masterFxConfig`), not from the shim that actually holds the
 * modules. `saveMasterFxChainConfig()` is the only writer of a per-set
 * `master_fx_<N>.json` carrying a module_id, and it reads that mirror.
 *
 * Movy loads a master slot by writing `master_fx:fxN:module` straight to the
 * shim (see browser/handler.ts), which the mirror never observes — nothing
 * notifies the QuickJS context of a shim-side load. So the mirror still reads
 * empty, and the next save takes its unguarded empty-slot branch and writes
 * "{}" over a slot the shim genuinely has loaded. The master chain is then gone
 * on the next boot (schwung-movy#9).
 *
 * Movy cannot win by writing the state file itself: schwung's shutdown flush
 * (shadow_save_state_now) runs after movy is unloaded and would erase it again.
 * The mirror is the only thing the saver believes, so the mirror is what has to
 * be corrected.
 *
 * `ctx` is shadow_ui.js's own published context object. It is documented for
 * fork view modules (schwung docs/FORKING.md), not for tools, so nothing on it
 * is a stable API — every property is probed before use and any failure is
 * logged and swallowed rather than allowed to break a module load.
 *
 * REMOVAL: once saveMasterFxChainConfig reads the shim instead of the mirror
 * (upstream PR), this whole file and its single call site in
 * browser/handler.ts can be deleted — the resync becomes a redundant no-op.
 */
import { ctx } from '/data/UserData/schwung/shadow/shadow_ui_ctx.mjs';
import { mlog } from '../log.js';

interface MasterFxCtx {
    loadMasterFxChainConfig?: () => void;
    scanForAudioFxModules?: () => unknown[];
    MASTER_FX_OPTIONS?: unknown[];
}

/* Point schwung's master-chain mirror back at what the shim actually has
 * loaded. Call after any write to `master_fx:fxN:module`, for loads and for
 * clears alike — schwung's resync reads all four slots, so it repairs both
 * directions of the drift. */
export function syncMasterFxMirror(): void {
    try {
        const c = ctx as MasterFxCtx | undefined;
        if (!c || typeof c.loadMasterFxChainConfig !== 'function') {
            mlog('mfx: no shadow ctx — master chain will not persist');
            return;
        }
        /* saveMasterFxChainConfig maps the id the resync stores back to a DSP
         * path through MASTER_FX_OPTIONS, which schwung scans once at boot. A
         * module installed since then is absent from that list and would
         * persist with an empty path — a file that looks saved but restores
         * nothing. Rescanning first is what makes the saved entry loadable. */
        if (typeof c.scanForAudioFxModules === 'function') {
            c.MASTER_FX_OPTIONS = c.scanForAudioFxModules();
        }
        c.loadMasterFxChainConfig();
        mlog('mfx: mirror resynced');
    } catch (e) {
        mlog('mfx: mirror resync failed: ' + e);
    }
}
