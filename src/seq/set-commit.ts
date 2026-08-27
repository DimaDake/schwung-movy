/* Making Move commit the Set you are actually on.
 *
 * Move writes `UserLibrary/Sets/<uuid>/` only once MOVE itself has something to
 * save there. Play entirely through schwung and it never does, so schwung has
 * no Set to file anything under and addresses the pad by a synthetic
 * `__pending-<index>-<seq>` — with a fresh seq on EVERY visit. Both stores lose
 * on that: the pad's sequence (movy's) and the pad's instruments (schwung's)
 * are written somewhere nothing will ever read again. `docs/pending-sets.md`
 * has the full picture.
 *
 * Rather than teach movy to work around an unreal Set, make the Set real. A
 * track-button press is enough for Move to commit it: measured on a device,
 * injecting CC 43 flipped `active_set.txt` from `__pending-12-13` to a real
 * uuid within seconds, movy's rename carried the pad's work across, and the Set
 * survived being left afterwards. schwung files its instruments under the same
 * real uuid without knowing anything happened, which is why this beats keying
 * movy's own files by pad: that would have fixed movy's half only.
 *
 * NEVER while parked. The set pads are Move's own UI, so that is where the user
 * is standing when they choose one — injecting a track press there would throw
 * them off the Sets page mid-selection. In front, the press is invisible: it
 * selects Move's track 1 under a screen movy owns. */

import { mlog } from '../log.js';
import { isProvisionalUuid } from './set-context.js';

/* Long enough to read as a press rather than a glitch, short enough to be over
 * before anything else could want the button. The tick rate swings 63-205 Hz,
 * so this is ~50-190 ms. */
const HOLD_TICKS = 10;

/* MoveRow1 — the same CC, and the same packet shape, that the track-volume
 * divert already injects (mixer/track-volume.ts). */
const TRACK_CC = 43;

let askedFor = '';       // the provisional id we have already asked Move to commit
let releaseIn = -1;      // ticks until the button goes up (-1 = not held)

export function resetSetCommit(): void {
    askedFor = '';
    releaseIn = -1;
}

function send(pressed: boolean): void {
    move_midi_inject_to_move([0x0B, 0xB0, TRACK_CC, pressed ? 127 : 0]);
}

/** Called once per tick with the live Set. Does nothing at all unless movy is
 *  in front on a Set Move has not committed, and at most once per such Set. */
export function setCommitTick(id: string, ready: boolean): void {
    if (releaseIn > 0) {
        if (--releaseIn === 0) { send(false); releaseIn = -1; }
        return;
    }
    if (!ready || !id || !isProvisionalUuid(id)) return;
    if (id === askedFor) return;                       // asked once; Move said no
    if (globalThis.overtakeParked === true) return;    // the user is in Move's UI
    if (typeof move_midi_inject_to_move !== 'function') return;

    askedFor = id;
    send(true);
    releaseIn = HOLD_TICKS;
    mlog('seq: asking Move to commit ' + id);
}
