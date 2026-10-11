/* "Leave Movy" modal — opened by Back at the root (Chain) view; its one
 * option is Close Movy. The same menu, titled "Power off?", is the shutdown
 * dialog (the host calls onPowerButton): Power off is the default, as Move's
 * own "Press wheel to shut down" is, and the jog click is the confirm —
 * nothing powers off on the button alone. It sits over a live instrument rather than blocking it:
 * see leaveModalPass for what the rest of the hardware does while it is up.
 * The sequencer keeps running on the DSP regardless.
 * See the transport/beat-clock design §7.4. */

import { CC_PLAY, CC_REC } from '../seq/constants.js';
import { appState } from './state.js';

export type LeaveAction = 'close' | 'poweroff' | 'cancel';
type ModalKind = 'leave' | 'power';

interface LeaveOption { label: string; action: LeaveAction; }

const LEAVE: LeaveOption[] = [{ label: 'Close Movy', action: 'close' }];
const POWER: LeaveOption[] = [{ label: 'Power off', action: 'poweroff' }, { label: 'Cancel', action: 'cancel' }];

function options(): LeaveOption[] {
    return leaveModalState.kind === 'power' ? POWER : LEAVE;
}

/* What an event that is not one of the modal's own controls (Back, jog turn,
 * jog click) may do while the modal is up. The default is `dismiss`, not
 * `swallow`: the menu is a question, and doing anything else with the hardware
 * answers it by walking away. Everything — pads, steps, Track, Session, Clear,
 * Capture, octave, Copy, Delete, Mute, Loop, the arrows — closes the menu and
 * still does its job, so getting out of it never costs a press.
 *
 * The two exceptions:
 *
 * - `through`: Shift and the transport run WITHOUT closing the menu. Shift is
 *   a modifier, so treating it as an answer would break every Shift combo the
 *   press was reaching for. Play/Rec are the one thing you plausibly want
 *   while deciding — stopping the music before you leave is not a change of
 *   mind.
 * - `swallow`: the eight param knobs and their touches. The menu is drawn over
 *   the whole screen, so a param edit behind it is one the user cannot see
 *   happen — and unlike a pad or a step, a knob has no other feedback to
 *   notice it by. The jog assembly is the menu's own control and never
 *   reaches here.
 *
 * `through` is the bucket with teeth: it can arm a hold the menu then outlives
 * (Rec latches step-record, Shift latches shiftHeld), which is why confirming
 * has to forget held input — see the caller in midi/router.ts. `dismiss` is
 * self-clearing, since the menu is gone before the release arrives. */
export type LeaveModalPass = 'dismiss' | 'through' | 'swallow';

export function leaveModalPass(data: number[]): LeaveModalPass {
    const type = data[0] & 0xF0;
    if (type === 0x90 || type === 0x80) {
        /* Notes 0..9 are the knob capacitive touches (8 = master, 9 = jog);
         * pads and step buttons are far above them. */
        return data[1] <= MoveKnob8Touch + 2 ? 'swallow' : 'dismiss';
    }
    /* Only the three types movy actually reads may answer the menu. The host
     * forwards a steady trickle of [0,0,0] into the overtake callback, and
     * "anything I don't recognise means the user walked away" let that junk
     * close the menu in the same millisecond Back opened it — no press
     * involved. A default of `dismiss` is only safe over decodable input. */
    if (type !== 0xB0) return 'swallow';
    const cc = data[1];
    if (cc >= MoveKnob1 && cc < MoveKnob1 + 8) return 'swallow';
    if (cc === MoveShift || cc === CC_PLAY || cc === CC_REC) return 'through';
    return 'dismiss';
}

export const leaveModalState: { active: boolean; sel: number; kind: ModalKind } =
    { active: false, sel: 0, kind: 'leave' };

export function leaveModalActive(): boolean { return leaveModalState.active; }

export function leaveModalLabels(): string[] { return options().map((o) => o.label); }

export function leaveModalSel(): number { return leaveModalState.sel; }

export function leaveModalTitle(): string {
    return leaveModalState.kind === 'power' ? 'Power off?' : 'Leave Movy?';
}

export function openLeaveModal(): void {
    leaveModalState.active = true;
    leaveModalState.kind   = 'leave';
    leaveModalState.sel    = 0;
}

/* The host's onPowerButton. A second press while it is up changes nothing. */
export function openPowerModal(): void {
    if (leaveModalState.active && leaveModalState.kind === 'power') return;
    leaveModalState.active = true;
    leaveModalState.kind   = 'power';
    leaveModalState.sel    = 0;   // default → Power off, confirmed by the jog click
    /* The host calls this between ticks with no MIDI behind it, so nothing else marks the frame stale. */
    appState.dirty = true;
}

export function closeLeaveModal(): void { leaveModalState.active = false; }

/* Move the highlight (jog turn). Wraps; no-op when there is a single option. */
export function leaveModalMove(delta: number): void {
    const n = options().length;
    if (n <= 1 || delta === 0) return;
    leaveModalState.sel = (leaveModalState.sel + (delta > 0 ? 1 : -1) + n) % n;
}

/* Confirm the highlighted option (jog click). Closes the modal and returns the
 * chosen action, or null if it was not active. */
export function leaveModalConfirm(): LeaveAction | null {
    if (!leaveModalState.active) return null;
    const opt = options()[leaveModalState.sel] ?? options()[0];
    leaveModalState.active = false;
    return opt.action;
}
