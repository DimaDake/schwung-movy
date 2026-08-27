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

/* Wall-clock, because ticks are not a duration here: the rate swings 43-220 Hz,
 * so "ten ticks" is anywhere from 45 to 230 ms.
 *
 * 1 s and 2 s are both known to work. The short presses that appeared to fail
 * proved nothing — they were sent while movy held the surface, so they never
 * reached Move at all — and the drain hands Move at most one packet per frame,
 * so press and release are already a frame apart at minimum. This is short
 * enough to keep Move's pads on screen briefly rather than for two seconds, and
 * long enough to be many frames. It is logged, so a failure to commit can be
 * read against the value that produced it. */
const HOLD_MS = 250;

/* MoveRow1 — the same CC, and the same packet shape, that the track-volume
 * divert already injects (mixer/track-volume.ts). */
const TRACK_CC = 43;

/* schwung holds the inject drain for 3 frames after an overtake exit, because a
 * packet arriving mid-transition aborts Move deep in its own stack. The press
 * has to land after that hold, not inside it. */
const SETTLE_MS = 250;

/* Move is still loading the Set it just switched to, and a press that arrives
 * inside that is swallowed. Waited out BEFORE the surface is lent, so it costs
 * nothing on screen. */
const SETTLE_SET_MS = 1500;

type Phase = 'idle' | 'waiting' | 'settling' | 'holding' | 'releasing';

let askedFor = '';       // the provisional id we have already asked Move to commit
let phase: Phase = 'idle';
let since = 0;           // when the current phase began
let tookSurface = false; // we lowered overtake_mode and owe it back
let repaint = false;     // the surface came back and the LEDs are Move's

/* Lowering overtake_mode hands Move the pad LEDs (shadow_led_queue.c strips its
 * sysex only while the tool holds the surface), and movy's LED layer only sends
 * what changed — so what Move painted would stay. The app layer owns the
 * repaint; taking the flag is how it hears about it. */
export function takeSurfaceReturn(): boolean {
    const v = repaint;
    repaint = false;
    return v;
}

export function resetSetCommit(): void {
    askedFor = '';
    phase = 'idle';
    since = 0;
    tookSurface = false;
    repaint = false;
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
     * movy's claim on the LEDs — take it back with the surface, and ask for the
     * full repaint that a resume does, since Move has been painting over us. */
    if (!toMove) { claimLedOwnership(); repaint = true; }
}

/** Called once per tick with the live Set. Does nothing at all unless movy is on
 *  a Set Move has not committed, and at most once per such Set. */
export function setCommitTick(id: string, ready: boolean): void {
    if (phase !== 'idle') {
        const waited = Date.now() - since;
        if (phase === 'waiting' && waited >= SETTLE_SET_MS) {
            surface(true); tookSurface = true;
            phase = 'settling'; since = Date.now();
        } else if (phase === 'settling' && waited >= SETTLE_MS) {
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
    /* Only from the front. Parked, movy could press without borrowing anything
     * — the drain is already open — but that press is swallowed: Move is still
     * loading the Set the user just picked, and the pad they picked it with is
     * the last thing it handled. Measured that way too: every parked attempt
     * did nothing, every attempt from the front committed. Nothing is lost by
     * waiting, because the Set becomes real the moment movy is back on screen,
     * long before any exit or crash could cost anything. */
    if (globalThis.overtakeParked === true) { askedFor = ''; return; }

    askedFor = id;
    phase = 'waiting'; since = Date.now();
    mlog('seq: will ask Move to commit ' + id + ' (hold ' + HOLD_MS + 'ms)');
}
