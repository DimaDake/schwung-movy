/* browser-test/logic/load-errors.mjs — a module that refused its load.
 *
 * Amino holds four instances, so a fifth track's Amino is refused inside
 * schwung's chain host, which leaves the track empty and says nothing. The
 * engine reports the last refusal as `lde=<seq>:<slot>:<component>:<module>`
 * (chain_load_check.rs, cargo-tested); this pins the UI's half: the real
 * status parser turns a new refusal into one toast naming track and module.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, _log } from './harness.mjs';

export async function run() {
    _log('\nload errors: a refused module says so');
    const { installMockFs, uninstallMockFs } = await import('../mock-fs.mjs');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqToastText, resetSeqToast } = await import('../../dist/esm/seq/render.js');
    const { resetLoadErrors } = await import('../../dist/esm/seq/load-errors.js');

    installMockFs({
        '/data/UserData/schwung/modules/sound_generators/amino/module.json': JSON.stringify({ id: 'amino', name: 'Amino' }),
    });
    resetSeqToast(); resetLoadErrors();

    parseStatusForTest('play=0 lde=0:0:-:-');
    eq('no refusal, no toast', seqToastText(), '');

    parseStatusForTest('play=0 lde=1:4:synth:amino');
    eq('a refusal names the track and the module', seqToastText(), 'T5: AMINO DID NOT LOAD');

    resetSeqToast();
    parseStatusForTest('play=0 lde=1:4:synth:amino');
    eq('the same refusal is said once', seqToastText(), '');

    parseStatusForTest('play=0 lde=2:15:synth:amino');
    eq('the next refusal is news again', seqToastText(), 'T16: AMINO DID NOT LOAD');

    resetSeqToast(); resetLoadErrors();
    uninstallMockFs();
}
