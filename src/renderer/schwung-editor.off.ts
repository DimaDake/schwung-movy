/* The stand-in for schwung-editor.ts in a build with the grid switched off.
 * See schwung-body.off.ts for why the module has to leave the graph rather than
 * merely be unreachable.
 *
 * UNLIKE THE OTHER TWO STUBS, MOST OF THIS DOES NOT THROW. The router asks
 * `schwungEditorActive()` on every Back, click and jog, whatever the mode, so
 * that one has to answer honestly — and the honest answer with no grid is "no
 * editor is open". `openSchwungEditor` likewise returns false, which is already
 * its documented "I cannot present this" reply.
 *
 * Only the two that presuppose an open editor throw, and they are unreachable
 * for the same reason: nothing opens one.
 */
import type { SchwungIntent, SchwungPage } from './schwung-page.js';

export function schwungEditorActive(): boolean { return false; }
export function schwungEditorIndex(): number { return -1; }
export function closeSchwungEditor(): void { /* nothing is open */ }
export function schwungEditorCancel(): void { /* nothing is open */ }
export function schwungEditorJog(_dir: number): void { /* nothing is open */ }

export function openSchwungEditor(_intent: SchwungIntent | null, _page: SchwungPage): boolean {
    return false;
}

export function schwungEditorCommit(): never {
    throw new Error(
        'movy: the Schwung param editor was asked to commit in a build that '
        + 'excluded it (MOVY_SCHWUNG_GRID=off). Rebuild with MOVY_SCHWUNG_GRID=page.');
}

export function renderSchwungEditor(): never {
    throw new Error(
        'movy: the Schwung param editor was asked to draw in a build that '
        + 'excluded it (MOVY_SCHWUNG_GRID=off). Rebuild with MOVY_SCHWUNG_GRID=page.');
}
