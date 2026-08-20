/* Stand-in for shadow_ui.js's published context object, which only exists
 * inside the device's QuickJS realm. The browser build aliases the device path
 * to this file (build/browser.mjs) so chain/master-mirror.ts is testable off
 * device.
 *
 * It records what movy asks of it, on globalThis so a test can reach it without
 * having to import the same bundled chunk. Delete alongside master-mirror.ts
 * when schwung's upstream fix lands.
 */
export const ctx = {
    MASTER_FX_OPTIONS: [],
    scanForAudioFxModules() {
        globalThis.__mfxCtxStub.scans++;
        return [{ id: 'mverb', name: 'MVerb', dspPath: '/x/mverb.so' }];
    },
    loadMasterFxChainConfig() {
        globalThis.__mfxCtxStub.resyncs++;
    },
};

globalThis.__mfxCtxStub = { scans: 0, resyncs: 0, ctx };
