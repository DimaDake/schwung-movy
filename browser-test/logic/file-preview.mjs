/* file-preview.mjs — a file browser that previews, and the module's hooks.
 *
 * Schwung's browser honours `live_preview` and `browser_hooks`; movy's wrote
 * nothing until a pick, so DR32's kit list (and granny's / magneto's samples)
 * could not be auditioned. Driven with the REAL declarations from the device
 * dump: mrdrums' pad sample (preview + `ui_auto_select_pad=off`, restored),
 * granny's sample (preview alone) and DR32's module.json Kit (preview +
 * kit_mark / kit_restore / kit_mark=0). Writes are read off the track port.
 *
 * Run by browser-test/logic.mjs.
 */
import { ok, eq, _log, env, MOCK_SYNTHS, appState, portFor } from './harness.mjs';
import { dumpEntry } from '../dump-fixture.mjs';

const DIR = '/data/UserData/UserLibrary/Track Presets';
const A = `${DIR}/A.ablpreset`, B = `${DIR}/B.ablpreset`, C = `${DIR}/C.ablpreset`;

/* What the DSP serves first, then module.json's fallback list — DR32 0.4.1
 * declares its Kit browser only in the latter. */
const declOf = (id, key) => {
    const e = dumpEntry(id);
    const served = JSON.parse(e.params.chain_params || '[]');
    const fallback = (e.module_json && e.module_json.capabilities && e.module_json.capabilities.chain_params) || [];
    return served.find((p) => p.key === key) || fallback.find((p) => p.key === key);
};

export async function run() {
    _log('\nlogic: file browser preview + browser_hooks (DR32 kit, granny)');
    const { openFileBrowser, navigateFileBrowser, activateFileBrowserItem, cancelFileBrowser }
        = await import('../../dist/esm/browser/file-handler.js');
    const { previewTick, PREVIEW_REST_MS } = await import('../../dist/esm/browser/file-preview.js');
    const { fileBrowseDeclOf } = await import('../../dist/esm/model/file-decl.js');
    const { VIEW_KNOBS } = await import('../../dist/esm/app/state.js');
    const { peekUndo } = await import('../../dist/esm/undo/state.js');

    const prevOs = globalThis.os;
    globalThis.os = {
        readdir: () => [['A.ablpreset', 'B.ablpreset', 'C.ablpreset'], 0],
        stat: (p) => [{ mode: p.endsWith('.ablpreset') ? 0x8000 : 0x4000 }, 0],
    };
    const port = portFor(0);
    const realSet = port.setParam;
    let writes = [];
    port.setParam = (k, v, ...r) => { writes.push(`${k}=${v}`); return realSet.call(port, k, v, ...r); };

    const open = (decl, current = A) => {
        env.setParams({ ...MOCK_SYNTHS.test16, 'synth:kit': current, 'synth:mon': '7',
                        'synth:ui_auto_select_pad': 'on' });
        writes = [];
        appState.browseOrigin = VIEW_KNOBS;
        openFileBrowser(0, 'synth', 'kit', -1, '/data', ['.ablpreset'], DIR, current, undefined, decl);
    };
    const rest = (t0) => previewTick(appState.fileBrowserState, t0 + PREVIEW_REST_MS + 1);

    try {
        const kit = fileBrowseDeclOf(declOf('dr32', 'kit'));
        ok('DR32 kit declares a preview and three hooks', kit && kit.live
           && kit.hooks.onOpen.length === 1 && kit.hooks.onCancel.length === 1 && kit.hooks.onCommit.length === 1);

        open(kit);
        eq('open: kit_mark=1, nothing previewed (the cursor is on the loaded kit)',
           writes.join(' '), 'synth:kit_mark=1');

        writes = [];
        const t0 = Date.now();
        navigateFileBrowser(1);
        previewTick(appState.fileBrowserState, t0 + 10);
        eq('a moving cursor previews nothing yet', writes.length, 0);
        navigateFileBrowser(1);
        rest(Date.now());
        eq('...and once it rests, only where it rested', writes.join(' '), `synth:kit=${C}`);

        writes = [];
        cancelFileBrowser();
        eq('Back: the original goes back, then kit_restore', writes.join(' '),
           `synth:kit=${A} synth:kit_restore=1`);
        ok('...and the browser is gone', appState.fileBrowserState === null);

        open(kit);
        navigateFileBrowser(1);
        rest(Date.now());
        writes = [];
        activateFileBrowserItem();
        ok('pick: the file is committed', writes.includes(`synth:kit=${B}`));
        /* B was previewed, so the param already held B at the pick: an undo
         * "before" read then would be B and the step would be dropped. */
        const op = (peekUndo()?.paramOps || []).find((o) => o.key === 'synth:kit');
        eq('...as ONE undo step back to the kit from before the browser opened',
           op ? `${op.old} > ${op.new}` : 'no undo step', `${A} > ${B}`);
        ok('...then kit_mark=0, and no restore', writes[writes.length - 1] === 'synth:kit_mark=0'
           && !writes.some((w) => w.startsWith('synth:kit_restore')));

        const granny = fileBrowseDeclOf(declOf('granny', 'sample_path'));
        ok('granny previews with no hooks', granny && granny.live && granny.hooks.onCancel.length === 0);
        open(granny);
        navigateFileBrowser(2);
        rest(Date.now());
        writes = [];
        cancelFileBrowser();
        eq('a plain preview is undone by writing the original back', writes.join(' '), `synth:kit=${A}`);

        open(null);
        navigateFileBrowser(1);
        rest(Date.now());
        eq('no declaration: nothing is written before a pick', writes.length, 0);
        cancelFileBrowser();
        eq('...nor on Back', writes.length, 0);

        const md = fileBrowseDeclOf(declOf('mrdrums', 'p03_sample_path'));
        open(md);
        eq('mrdrums: pads stop moving the focus while browsing', writes.join(' '),
           'synth:ui_auto_select_pad=off');
        navigateFileBrowser(1);
        rest(Date.now());
        writes = [];
        activateFileBrowserItem();
        eq('...and after the pick it is put back as it was', writes[writes.length - 1],
           'synth:ui_auto_select_pad=on');

        open(fileBrowseDeclOf({ browser_hooks: { on_open: [{ key: 'mon', value: '$filename', restore: true }] } }));
        eq('a hook value names the file', writes.join(' '), 'synth:mon=A.ablpreset');
        writes = [];
        cancelFileBrowser();
        eq('...and a restore hook is put back on close', writes.join(' '), 'synth:mon=7');
    } finally {
        port.setParam = realSet;
        globalThis.os = prevOs;
        appState.fileBrowserState = null;
        env.setParams(MOCK_SYNTHS.test16);
    }
}
