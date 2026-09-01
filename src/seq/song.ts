/* Song mode: hold Shift in Session view and press scenes to build an
 * arrangement out of them.
 *
 * Only the GESTURE lives here. The engine owns the song itself — the sequence,
 * the scene lengths, the bar countdown and the switching — and this module
 * reads it back from the `song=` mirror in state.ts. Keeping the schedule in
 * the engine is what lets a scene change land on the same bar boundary that
 * already resolves clip launches, instead of on whichever UI tick noticed.
 *
 * The eight scenes sit on the step buttons printed 1,3,5…15 — 0-indexed
 * 0,2,4…14 — one per clip column. The rest are inert. */

import { seqCmd } from './engine.js';
import { appState } from '../app/state.js';
import { seqState } from './state.js';
import { C_BLACK, C_GREEN, ANIM_NONE, ANIM_PULSE } from './colors.js';

export const NUM_SCENES = 8;

/* Declared here rather than imported from leds.ts: leds.ts imports this module
 * to paint the row, and a type import back would tie the two together for no
 * gain. session.ts keeps its own copy for the same reason. */
export interface SceneLed { base: number; anim: number; channel: number; }

/* Whether this Shift hold has already placed its first scene. The FIRST press
 * of a hold REPLACES the song and every later press appends, so one hold is
 * one song — and a bare Shift press with no scene leaves a running song alone.
 * Shift is reached for constantly; it must never be the thing that destroys an
 * arrangement. */
let holdStarted = false;

/* Steps whose PRESS the scene row consumed, so their release is consumed too.
 * A bit per step rather than "Shift is still down": releasing Shift before the
 * finger leaves the button would otherwise drop that release into the track
 * selector, which would switch tracks off a press that never meant to. */
let scenePresses = 0;

/** Shift went down or up. */
export function songShift(down: boolean): void {
    if (down) holdStarted = false;
}

/** The scene a step button addresses, or -1 when the step is inert. */
export function sceneForStep(step: number): number {
    if (step < 0 || step >= NUM_SCENES * 2 || step % 2 !== 0) return -1;
    return step >> 1;
}

/** A press or release on the scene row. The row consumes both either way. */
export function songSceneStep(step: number, on: boolean): void {
    const bit = 1 << step;
    if (!on) {
        scenePresses &= ~bit;
        return;
    }
    scenePresses |= bit;
    const scene = sceneForStep(step);
    if (scene < 0) return;              // an inert step is consumed, and does nothing
    if (holdStarted) {
        seqCmd('songadd ' + scene);
    } else {
        seqCmd('song ' + scene);
        holdStarted = true;
    }
    appState.dirty = true;
}

/** True when this release belongs to a press the scene row already consumed. */
export function songSceneReleasePending(step: number): boolean {
    return (scenePresses & (1 << step)) !== 0;
}

/* The scene row's LEDs. A scene the song uses PULSES, so the whole arrangement
 * reads as queued at a glance rather than only the scene that happens to be
 * next. The lit colour goes in `anim`, never in `base`: firmware that ignores
 * the base once a pulse channel is set must still show the colour (leds.ts). */
export function sceneStepLed(step: number, songScenes: number[]): SceneLed {
    const scene = sceneForStep(step);
    if (scene < 0) return { base: C_BLACK, anim: C_BLACK, channel: ANIM_NONE };
    if (songScenes.indexOf(scene) >= 0) {
        return { base: C_BLACK, anim: C_GREEN, channel: ANIM_PULSE };
    }
    return { base: C_GREEN, anim: C_GREEN, channel: ANIM_NONE };
}

export function resetSong(): void {
    holdStarted = false;
    scenePresses = 0;
}

export interface SongToken { label: string; current: boolean; }

/* Where the current entry ends: a run of identical presses is ONE entry, so
 * both `2`s of `1 2 2 3` are highlighted together. */
function entryEnd(scenes: number[], pos: number): number {
    let i = pos;
    while (i < scenes.length && scenes[i] === scenes[pos]) i++;
    return i;
}

/* The song as display tokens, windowed to `maxW` pixels so the entry now
 * playing and the one after it are always on screen — you should never have to
 * guess where in the arrangement you are. The window then fills leftward with
 * as much history as fits, so what you just heard stays visible too.
 *
 * `width` is injected rather than imported so this is testable without the
 * font, and so the caller measures with the same function it draws with. */
export function songBandTokens(
    scenes: number[], pos: number, maxW: number, width: (s: string) => number,
): { tokens: SongToken[]; leading: boolean } {
    if (scenes.length === 0) return { tokens: [], leading: false };
    const curFrom = Math.min(Math.max(pos, 0), scenes.length - 1);
    const curTo = entryEnd(scenes, curFrom);
    /* The last index that MUST be visible: the end of the entry AFTER the
     * current one, or the end of the song when the current entry is last. */
    const must = entryEnd(scenes, Math.min(curTo, scenes.length - 1)) - 1;

    const label = (i: number) => String(scenes[i] + 1);
    const GAP = 2;
    const span = (a: number, b: number) => {
        let w = 0;
        for (let i = a; i <= b; i++) w += (i > a ? GAP : 0) + width(label(i));
        return w;
    };

    /* Start from the span that MUST fit, then grow outwards while there is
     * room: right first, so what is coming stays visible in preference to what
     * has already been played. */
    let from = curFrom;
    let to = must;
    let used = span(from, to);
    while (to < scenes.length - 1 && used + GAP + width(label(to + 1)) <= maxW) {
        used += GAP + width(label(to + 1));
        to++;
    }
    while (from > 0 && used + GAP + width(label(from - 1)) <= maxW) {
        used += GAP + width(label(from - 1));
        from--;
    }

    const tokens: SongToken[] = [];
    for (let i = from; i <= to; i++) {
        tokens.push({ label: label(i), current: i >= curFrom && i < curTo });
    }
    return { tokens, leading: from > 0 };
}

/* The song is parked on its END: the entry now playing names a column with no
 * clip on any track, so the arrangement stops there (the transport keeps
 * running). Derived from the same clip existence the engine reads rather than
 * from a status field of its own, so the readout cannot disagree with what the
 * engine actually did. */
export function songTerminal(): boolean {
    const n = seqState.songScenes.length;
    if (n === 0) return false;
    const scene = seqState.songScenes[Math.min(seqState.songPos, n - 1)];
    return !seqState.session.some((st) => (st.exist & (1 << scene)) !== 0);
}

/* The band shows while Shift is held in Session view — so it appears the
 * instant you press Shift, empty, telling you the row has become the scenes —
 * and for as long as a song is active. Outside Session view it never draws. */
export function songBandVisible(): boolean {
    if (!seqState.sessionMode) return false;
    return appState.shiftHeld || seqState.songScenes.length > 0;
}
