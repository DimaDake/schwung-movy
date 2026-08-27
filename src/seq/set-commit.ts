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
 * ONLY while parked, and that is not a preference — it is the only window that
 * exists. schwung's inject drain refuses to feed Move's MIDI_IN whenever a tool
 * is overtaking:
 *
 *     In OVERTAKE mode the queue belongs to the overtake publisher in
 *     schwung_shim.c, not to us.  ...  if (sc->overtake_mode != 0) return;
 *          — shadow_midi.c, shadow_drain_midi_inject()
 *
 * The ring is repurposed for the overtake module, so a packet pushed while movy
 * is in front never reaches Move at all. Measured here the same way: three
 * presses from movy in front did nothing, the identical bytes pushed while movy
 * was parked committed the Set every time.
 *
 * Parked is also where the user already is when this matters — they are on
 * Move's Sets page having just chosen an empty pad, and pressing a track button
 * there is the very gesture that commits it by hand. */

import { mlog } from '../log.js';
import { isProvisionalUuid } from './set-context.js';

/* Measured, not guessed. A press held 1 s and one held 2 s both made Move
 * commit the Set; three presses of ~10 ticks did nothing at all. Ticks were the
 * wrong unit — the rate swings 43-220 Hz on this device, so ten of them is
 * anywhere from 45 to 230 ms — so this is wall-clock, with margin over the
 * shortest hold known to work. */
const HOLD_MS = 1200;

/* MoveRow1 — the same CC, and the same packet shape, that the track-volume
 * divert already injects (mixer/track-volume.ts). */
const TRACK_CC = 43;

let askedFor = '';       // the provisional id we have already asked Move to commit
let pressedAt = 0;       // when the button went down (0 = not held)

export function resetSetCommit(): void {
    askedFor = '';
    pressedAt = 0;
}

function send(pressed: boolean): void {
    move_midi_inject_to_move([0x0B, 0xB0, TRACK_CC, pressed ? 127 : 0]);
}

/** Called once per tick with the live Set. Does nothing at all unless movy is
 *  in front on a Set Move has not committed, and at most once per such Set. */
export function setCommitTick(id: string, ready: boolean): void {
    if (pressedAt !== 0) {
        if (Date.now() - pressedAt >= HOLD_MS) { send(false); pressedAt = 0; }
        return;
    }
    if (!ready || !id || !isProvisionalUuid(id)) return;
    if (id === askedFor) return;                       // asked once; Move said no
    /* In front, the packet would be dropped by the drain — see the header. */
    if (globalThis.overtakeParked !== true) return;
    if (typeof move_midi_inject_to_move !== 'function') return;

    askedFor = id;
    send(true);
    pressedAt = Date.now() || 1;   // 0 is the "not held" sentinel

    mlog('seq: asking Move to commit ' + id);
}
