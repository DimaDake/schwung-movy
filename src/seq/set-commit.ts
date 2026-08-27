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
 * The press cannot simply be sent. schwung's inject drain refuses to feed
 * Move's MIDI_IN whenever a tool is overtaking:
 *
 *     In OVERTAKE mode the queue belongs to the overtake publisher in
 *     schwung_shim.c, not to us.  ...  if (sc->overtake_mode != 0) return;
 *          — shadow_midi.c, shadow_drain_midi_inject()
 *
 * so a packet pushed while movy is on screen never reaches Move at all — three
 * presses sent that way did nothing, while the identical bytes sent with movy
 * parked committed the Set every time.
 *
 * `shadow_set_overtake_mode` is exposed to modules, so movy lowers the flag for
 * the length of one press and puts it back. Verified on device with movy in
 * front throughout: `__pending-26-25` became a real uuid and movy kept the
 * surface. Doing it WITHOUT parking is what makes this cover the paths parking
 * cannot — an instant Shift+Back exit, a crash, a power cut — because the Set
 * is real within seconds of opening rather than whenever the user next parks.
 *
 * The cost, stated plainly: for ~1.5 s the surface belongs to Move, so a pad
 * pressed in that window plays Move rather than movy, and schwung sees an
 * overtake exit and re-entry (it holds the inject drain 3 frames across that
 * transition, which is why the press waits before going out). That is also why
 * this is behind `setcommit` — on by default, because the alternative is losing
 * the Set, but switchable. When movy is already parked the drain is open and
 * none of this applies: the press just goes. */

import { mlog } from '../log.js';
import { claimLedOwnership } from '../app/led-ownership.js';
import { flagValue } from './flags.js';
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

/* schwung holds the inject drain for 3 frames after an overtake exit, because a
 * packet arriving mid-transition aborts Move deep in its own stack. The press
 * has to land after that hold, not inside it. */
const SETTLE_MS = 300;

type Phase = 'idle' | 'settling' | 'holding' | 'releasing';

let askedFor = '';       // the provisional id we have already asked Move to commit
let phase: Phase = 'idle';
let since = 0;           // when the current phase began
let tookSurface = false; // we lowered overtake_mode and owe it back

export function resetSetCommit(): void {
    askedFor = '';
    phase = 'idle';
    since = 0;
    tookSurface = false;
}

function send(pressed: boolean): void {
    move_midi_inject_to_move([0x0B, 0xB0, TRACK_CC, pressed ? 127 : 0]);
}

/* Hand the surface to Move so the drain will run, or take it back. Only when
 * movy is actually in front: parked, the flag is already 0 and is not ours. */
function surface(toMove: boolean): void {
    if (typeof shadow_set_overtake_mode !== 'function') return;
    shadow_set_overtake_mode(toMove ? 0 : 2);
    /* Lowering the flag clears overtake_suppress_sysex (shadow_ui.c), which is
     * movy's claim on the LEDs — take it back with the surface. */
    if (!toMove) claimLedOwnership();
}

/** Called once per tick with the live Set. Does nothing at all unless movy is on
 *  a Set Move has not committed, and at most once per such Set. */
export function setCommitTick(id: string, ready: boolean): void {
    if (phase !== 'idle') {
        const waited = Date.now() - since;
        if (phase === 'settling' && waited >= SETTLE_MS) {
            send(true);
            phase = 'holding'; since = Date.now();
        } else if (phase === 'holding' && waited >= HOLD_MS) {
            send(false);
            phase = 'releasing'; since = Date.now();
        } else if (phase === 'releasing' && waited >= SETTLE_MS) {
            if (tookSurface) { surface(false); tookSurface = false; }
            phase = 'idle';
        }
        return;
    }
    if (!ready || !id || !isProvisionalUuid(id)) return;
    if (id === askedFor) return;                       // asked once; Move said no
    if (flagValue('setcommit') === 0) return;
    if (typeof move_midi_inject_to_move !== 'function') return;

    askedFor = id;
    /* Parked, the drain is already open and the flag is not ours to touch. */
    if (globalThis.overtakeParked !== true) { surface(true); tookSurface = true; }
    phase = 'settling'; since = Date.now();

    mlog('seq: asking Move to commit ' + id
        + (tookSurface ? ' (lending it the surface)' : ' (parked)'));
}
