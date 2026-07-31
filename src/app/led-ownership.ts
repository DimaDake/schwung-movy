import { mlog } from '../log.js';

/* Move paints its RGB pads, steps and grid with cable-0 LED sysex. Full
 * overtake strips its note and CC LED writes but not sysex, so with the Play
 * link on — Move's sequencer still running — its repaints land on top of ours
 * and stick: our LED layer only sends colours that changed, so a step Move
 * painted is never corrected. Resending cannot win against a peer that
 * repaints continuously, so take the sysex away from it (schwung
 * docs/CORUN.md).
 *
 * Must be re-claimed on every resume, not just at init: the framework zeroes
 * overtake_suppress_sysex when we park (schwung shadow_ui.js:3180-3187) and
 * resumeOvertakeModule never re-applies it, while init() is not re-run. */
export function claimLedOwnership(): void {
    if (typeof shadow_set_overtake_suppress_sysex === 'function') {
        shadow_set_overtake_suppress_sysex(1);
        mlog('LED ownership claimed (overtake sysex suppression on)');
    }
}
