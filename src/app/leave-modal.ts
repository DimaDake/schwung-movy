/* "Leave Movy" modal — opened by Back at the root (Chain) view. It offers
 * Background (park under Move's native UI, sequencer keeps playing) vs Close
 * Movy (full exit). While it is up, movy swallows most other input so a stray
 * pad/step never fires; the sequencer keeps running on the DSP regardless.
 * See the transport/beat-clock design §7.4. */

import { CC_NOTE_SESSION, CC_PLAY, CC_REC, CC_TRACK_END, CC_TRACK_START } from '../seq/constants.js';

export type LeaveAction = 'background' | 'close';

interface LeaveOption { label: string; action: LeaveAction; }

/* Background is only offered on a host that supports self-managed suspend;
 * older hosts show Close Movy only. */
function options(): LeaveOption[] {
    const opts: LeaveOption[] = [];
    if (typeof host_suspend_overtake === 'function') {
        opts.push({ label: 'Background', action: 'background' });
    }
    opts.push({ label: 'Close Movy', action: 'close' });
    return opts;
}

/* What a CC that is not one of the modal's own controls (Back, jog) may do
 * while the modal is up.
 *
 * - `dismiss`: Track and Session close the modal AND still do their job.
 *   Reaching for a track is the user saying they are staying, so making them
 *   press twice would be pedantry. The press is only safe to pass on because
 *   the modal is gone before the matching release arrives, so the momentary
 *   pairs up normally.
 * - `through`: transport runs underneath without closing anything. The
 *   sequencer plays either way, so Play/Rec are about the music, not about
 *   this dialog — and neither repaints the screen the modal owns.
 * - `swallow`: everything else, including the eight param knobs. The modal is
 *   drawn over the whole screen, so an edit made behind it is one the user
 *   cannot see happen.
 *
 * Anything that passes can arm a hold (Rec latches step-record), which is why
 * confirming must forget held input — see the caller in midi/router.ts. */
export type LeaveModalPass = 'dismiss' | 'through' | 'swallow';

export function leaveModalPass(cc: number): LeaveModalPass {
    if (cc === CC_NOTE_SESSION) return 'dismiss';
    if (cc >= CC_TRACK_START && cc <= CC_TRACK_END) return 'dismiss';
    if (cc === CC_PLAY || cc === CC_REC) return 'through';
    return 'swallow';
}

export const leaveModalState = { active: false, sel: 0 };

export function leaveModalActive(): boolean { return leaveModalState.active; }

export function leaveModalLabels(): string[] { return options().map((o) => o.label); }

export function leaveModalSel(): number { return leaveModalState.sel; }

export function openLeaveModal(): void {
    leaveModalState.active = true;
    leaveModalState.sel    = 0;   // default → Background (Close Movy on old hosts)
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
