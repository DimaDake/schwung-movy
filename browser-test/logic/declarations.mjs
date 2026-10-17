/* browser-test/logic/declarations.mjs — the value a declared `focus_param`
 * actually wants: a level name, not a pad number.
 *
 * (`access` and `short_name` were read by movy's own page cells; Schwung's
 * planner reads them now.)
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, _log } from './harness.mjs';

export async function run() {

_log('\nTest: a declared focus_param is written a LEVEL NAME, not a pad number');
{
    const { effectiveDrumConfig } = await import('../../dist/esm/model/drum-declared.js');
    const declared = {
        layout: 'drums',
        focusParam: 'ui_voice',
        voices: [
            { note: 36, name: 'Bass Drum', level: 'bass_drum' },
            { note: 38, name: 'Snare',     level: 'snare' },
        ],
    };
    const cfg = effectiveDrumConfig(declared, null);
    eq('the focus param is adopted', cfg.currentPadParam, 'ui_voice');
    /* The WHOLE array, not two indexes: a missing field would make `[0]` throw
     * and abort the suite before any failure line is printed, which reads as a
     * pass to anything grepping the output. */
    eq('each pad focuses its own level',
       JSON.stringify(cfg.padFocusValues), '["bass_drum","snare"]');

    /* A hand-written config is the template shape: its param takes the instance
     * NUMBER, so it must not gain level names it has none of. */
    const handConfig = {
        padCount: 4, padNoteStart: 36, rawMidi: false, currentPadParam: 'ui_current_pad',
    };
    const kept = effectiveDrumConfig(null, handConfig);
    eq('a table-only rack keeps its own param', kept.currentPadParam, 'ui_current_pad');
    eq('and gains no level names', kept.padFocusValues, undefined);
}

}
