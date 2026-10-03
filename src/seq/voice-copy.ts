/* voice-copy.ts — a drum track's step copy takes the selected voice only
 * (plan 2026-09-30, D16).
 *
 * Move's step and bar paste on a drum track copy the SELECTED voice's notes and
 * nothing else (measured by Schwung, `lane_voice_map.mjs`). movy's step LEDs on
 * a drum track already show only that voice, so a copy that carried every
 * voice pasted notes the user could not see. The automation follows the same
 * rule: only the locks on that voice's own keys move, and a destination keeps
 * every other voice's notes and locks.
 *
 * The engine owns the clipboard and knows LANES; which lanes are the voice's is
 * a question about keys, answered here from the module's declared voice map
 * (`model.voiceKeysOf`). A module with no map — melodic, or a rack known only
 * from a movy_config — copies whole steps, as before.
 */
import { componentModelOf } from '../app/modulated-keys.js';
import { automationRegistry } from './automation.js';
import { seqState } from './state.js';
import { watchedTrack } from './watch.js';

/** The `cpy` suffix " <pitch> <laneMask>" for a per-voice copy on `track`, or
 *  "" for a whole-step one. */
export function voiceCopyArgs(track: number): string {
    if (track !== watchedTrack() || seqState.watchLane < 0) return '';
    /* A drum rack is a sound generator: it sits in the synth slot. */
    const model = componentModelOf(track, 'synth');
    const keys = model && typeof model.voiceKeysOf === 'function'
        ? model.voiceKeysOf(model.getDrumCurrentPad()) : null;
    if (!keys) return '';
    const own = new Set(keys.map((k: string) => model!.getComponentKey() + ':' + k));
    let mask = 0;
    automationRegistry()[track].forEach((e, lane) => {
        if (e && own.has(e.targetParam)) mask |= 1 << lane;
    });
    return ' ' + seqState.watchLane + ' ' + (mask >>> 0);
}
