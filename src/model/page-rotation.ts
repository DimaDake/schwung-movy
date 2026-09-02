/* The jog rotation over a config's banks.
 *
 * A bank that names a `pad` is a VOICE page: one of a set the pad chooses among.
 * Giving each of them its own seat in the rotation is what makes an 8W8 nineteen
 * pages and a nineteen-dot bank bar — unreadable, and a jog walk through fifteen
 * voices to reach Delay. So the voice pages collapse into a single VOICE SLOT
 * that shows whichever voice the pad last selected.
 *
 * A bank with NO `pad` is a page in its own right and keeps its own seat, which
 * is what makes the rotation Master -> <voice> -> Reverb -> Delay on both 8W8
 * and 9W9. That is also the whole contract: voice-ness is not declared
 * separately, it IS having a pad. A module that puts a pad on a page with no
 * voice behind it (a spare grid seat opening Reverb) takes that page out of the
 * rotation and makes it reachable only by pad — see the config lint.
 *
 * The core is pure — bank indices in, bank indices out; `pageRotation` is the
 * one thin adapter that reads it off ModelState, so index.ts and viewmodel.ts
 * cannot disagree about what the rotation is.
 */
import type { ModelState } from './state.js';
import { KNOBS_PER_PAGE } from './constants.js';

export interface Rotation {
    /* The bank index at each rotation position. Position `voicePos` holds the
     * currently-selected voice, so this list changes as pads are pressed. */
    entries:  number[];
    /* Rotation position of the voice slot, or -1 when no bank claims a pad —
     * the ordinary case, where the rotation is just the banks. */
    voicePos: number;
}

/* `pads[i]` is bank i's declared pad, or undefined. `voiceBank` is the bank the
 * voice slot should show; it is corrected to the first voice bank when it does
 * not name one (a stale value after a module swap, or a fresh config). */
export function buildRotation(pads: (number | undefined)[], voiceBank: number): Rotation {
    const entries: number[] = [];
    let voicePos = -1;
    const firstVoice = pads.findIndex(p => p !== undefined);
    const shown = pads[voiceBank] !== undefined ? voiceBank : firstVoice;
    for (let i = 0; i < pads.length; i++) {
        if (pads[i] === undefined) { entries.push(i); continue; }
        if (voicePos >= 0) continue;          // the rest share the one slot
        voicePos = entries.length;
        entries.push(shown);
    }
    return { entries, voicePos };
}

/* Where a bank sits in the rotation. A voice bank that is not the one on show
 * has no seat of its own, so it reports the voice slot's position. */
export function rotationPos(rot: Rotation, bank: number): number {
    const i = rot.entries.indexOf(bank);
    return i >= 0 ? i : rot.voicePos;
}

/* Shift+jog's level walk, over whatever index space the caller hands it: the
 * banks themselves, or the rotation's positions. Extracted so both share one
 * implementation — from mid-level a backward jump lands on the current level's
 * own head first, the "back out to the section start" feel of a paragraph jump.
 */
export function stepGroup(groups: number[], cur: number, delta: number): number {
    const n = groups.length;
    if (n === 0) return cur;
    const here = groups[cur];
    let next = cur;
    if (delta > 0) {
        while (next < n - 1 && groups[next] === here) next++;
    } else {
        while (next > 0 && groups[next] === here) next--;
        const target = groups[next];
        while (next > 0 && groups[next - 1] === target) next--;
    }
    return next;
}

/* The rotation for a model's current pages. Generic hierarchy pages (no module
 * config) have no banks to collapse, so they get the plain page list — that is
 * every module in the fleet except the handful that declare `pad`. */
export function pageRotation(s: ModelState): Rotation {
    const banks = s.moduleConfig?.banks;
    if (!banks || !banks.length) {
        const n = Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE));
        return { entries: Array.from({ length: n }, (_, i) => i), voicePos: -1 };
    }
    return buildRotation(banks.map(b => b.pad), s.voiceBank);
}
