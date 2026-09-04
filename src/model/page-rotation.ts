/* The jog rotation over a config's banks.
 *
 * A drum module whose voices are separate circuits wants a page PER voice, but
 * one SEAT for them: sixteen voices at sixteen seats is a sixteen-dot bank bar
 * and a jog walk through the whole kit to reach the delay. So the voice pages
 * collapse into a single VOICE SLOT holding whichever voice the pad selected,
 * and the rest of the banks keep their own seats behind it.
 *
 * That is deliberately the same shape movy already had for `padSpecific`
 * (forge, weird-dreams): one pad-following page first, ordinary pages after it.
 * The only difference is what is behind the page — padSpecific re-points ONE
 * set of alias keys at the focused pad, which suits a kit whose voices share a
 * control set; the voice slot shows a DIFFERENT page per voice, which is what a
 * 909 needs, where the snare has no Attack and the kick has no FX sends.
 *
 * THE SHAPE IS FIXED, and this is the only shape movy accepts:
 *
 *     banks: [ voice, voice, voice, ..., page, page, ... ]
 *              ^-- every one declares `pad`     ^-- none of them do
 *
 * The voice run is the LEADING run of banks that declare a pad. A `pad` on any
 * bank after it is ignored — it is an ordinary page. That rules out the two
 * shapes that read as reasonable and are not: a voice bank buried behind Master
 * (nothing would open on it), and a page-only pad — a spare grid seat that
 * opens Reverb — which would silently turn Reverb into a voice.
 *
 * The core is pure — bank indices in, bank indices out; `pageRotation` is the
 * one thin adapter that reads it off ModelState, so index.ts, viewmodel.ts and
 * the renderers cannot disagree about what the rotation is.
 */
import type { ModelState } from './state.js';
import { KNOBS_PER_PAGE } from './constants.js';

export interface Rotation {
    /* The bank index at each rotation position. Position 0 holds the currently
     * selected voice when there is a voice run, so this list changes as pads
     * are pressed. */
    entries:    number[];
    /* Rotation position of the voice slot: 0 when the config has a voice run,
     * -1 when it has none — the ordinary case, where the rotation is just the
     * banks. Named rather than assumed so a reader of rotationPos does not have
     * to know the slot is always first. */
    voicePos:   number;
    /* Banks in the leading voice run. Banks [0, voiceCount) are voice pages;
     * everything from voiceCount on is an ordinary page. */
    voiceCount: number;
}

/* `pads[i]` is bank i's declared pad, or undefined. `voiceBank` is the bank the
 * voice slot should show; it falls back to the first voice when it names a bank
 * outside the run (a stale value carried across a module swap). */
export function buildRotation(pads: (number | undefined)[], voiceBank: number): Rotation {
    let voiceCount = 0;
    while (voiceCount < pads.length && pads[voiceCount] !== undefined) voiceCount++;

    if (voiceCount === 0) {
        return { entries: pads.map((_, i) => i), voicePos: -1, voiceCount: 0 };
    }
    const shown = voiceBank >= 0 && voiceBank < voiceCount ? voiceBank : 0;
    const entries = [shown];
    for (let i = voiceCount; i < pads.length; i++) entries.push(i);
    return { entries, voicePos: 0, voiceCount };
}

/* Is this bank one of the voice pages? Everything that treats the voice slot
 * differently — the pad-grid icon, whether a pad turns the page — asks here, so
 * "voice page" has exactly one definition. */
export function isVoiceBank(rot: Rotation, bank: number): boolean {
    return rot.voiceCount > 0 && bank >= 0 && bank < rot.voiceCount;
}

/* Where a bank sits in the rotation. A voice bank that is not the one on show
 * has no seat of its own, so it reports the voice slot's position. */
export function rotationPos(rot: Rotation, bank: number): number {
    if (isVoiceBank(rot, bank)) return rot.voicePos;
    const i = rot.entries.indexOf(bank);
    return i >= 0 ? i : 0;
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
        return { entries: Array.from({ length: n }, (_, i) => i), voicePos: -1, voiceCount: 0 };
    }
    return buildRotation(banks.map(b => b.pad), s.voiceBank);
}
