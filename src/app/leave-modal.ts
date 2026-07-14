/* "Leave Movy" modal — opened by Back at the root (Chain) view. It offers
 * Background (park under Move's native UI, sequencer keeps playing) vs Close
 * Movy (full exit). While it is up, movy swallows all other input so a stray
 * pad/step never fires; the sequencer keeps running on the DSP regardless.
 * See the transport/beat-clock design §7.4. */

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
