/* Handing live pad input to the engine, so a movy track's notes stop costing a
 * blocking param write each.
 *
 * A host track's pad note is one non-blocking `shadow_send_midi_to_dsp`. A movy
 * track has no shadow slot, so every note went out as a BLOCKING engine param
 * write — 2.12 ms of IPC per tick on device against 0.30 ms for a host track,
 * and it multiplies with chords because it blocks.
 *
 * The shim already delivers pad notes to the overtake DSP on the audio thread
 * (`schwung_shim.c:6950`; confirmed by probe on real presses), so the engine can
 * answer them itself. This module keeps the engine's copy of the pad→pitch map
 * current; the mapping itself stays here, where scale, octave, layout and drum
 * lane live.
 *
 * **Pushed by comparison, not by event.** The map is rebuilt each tick and sent
 * only when it differs from what was last sent. Enumerating the things that
 * change it — track switch, octave, root, scale, layout, drum lane, module
 * change — is a list that would silently rot; comparing the actual value cannot.
 */

import { appState } from '../app/state.js';
import { drumNoteOfPhys, drumShiftSelect } from '../keyboard/drum-grid.js';
import { seqState } from '../seq/state.js';
import { PAD_MIN } from '../seq/constants.js';
import { padPitch } from '../seq/pads.js';
import { padsPlayNotes } from '../seq/router-pads.js';
import type { DrumConfig } from '../types/param.js';
import { chainInstance, trackKind } from './ref.js';

const PAD_COUNT = 32;

/* What the engine currently believes. Empty until the first push. */
let pushed = '';
let pushedVel = '';

/* The active track's drum rack, or null when its synth is melodic. Read from
 * the SYNTH slot (chain index 1) like every other drum question, so browsing an
 * FX page cannot change what a pad plays. */
function drumConfigFor(track: number): DrumConfig | null {
    return appState.trackModels[track]?.[1]?.getDrumConfig() ?? null;
}

/** Rebuild the map string for the active track. `-1` chain = the UI keeps pads
 *  (host track, no movy chain selected, or the pads are not playing notes at
 *  all — in Session view they are the clip grid, and the engine cannot see a UI
 *  mode, so launching a clip sounded the synth underneath it).
 *
 *  A drum track maps its pads through the RACK, not the keyboard: the note a
 *  drum pad plays is a pad address. Sending the melodic map here is what made
 *  one press sound twice — the UI's kick and the engine's chromatic note, which
 *  on a 36-based rack is another pad entirely.
 *
 *  Shift on a drum track makes the pads a selector, and whether the selected pad
 *  also sounds is a per-module decision the UI holds — so the pads go back to
 *  the UI for as long as Shift is down. It is pushed on the tick that sees the
 *  button, so pressing Shift and a pad inside one tick period (~5-15 ms) can
 *  still let the engine answer the press; holding Shift first, as the gesture
 *  is played, cannot. */
function buildMap(): string {
    const t = appState.activeTrack.index;
    const drum = drumConfigFor(t);
    const owns = padsPlayNotes()
        && trackKind(t) === 'movy'
        && !drumShiftSelect(appState.shiftHeld, drum);
    const chain = owns ? chainInstance(t) : -1;
    const parts: (string | number)[] = [chain];
    for (let i = 0; i < PAD_COUNT; i++) {
        const pad = PAD_MIN + i;
        parts.push(chain < 0 ? -1
            : drum ? drumNoteOfPhys(pad, PAD_MIN, drum)
            : padPitch(t, pad, PAD_MIN));
    }
    return parts.join(',');
}

/** True when the ENGINE is answering pads for this track, so the UI must not
 *  also send them — two sources would double-trigger every note. */
export function engineOwnsPads(track: number): boolean {
    return trackKind(track) === 'movy'
        && pushed !== ''
        && pushed.startsWith(chainInstance(track) + ',');
}

/** Push the map and Full Velocity if either changed. Called once per tick;
 *  cheap when nothing moved.
 *
 *  Full Velocity travels with the map because it belongs to the note the ENGINE
 *  builds: for a movy track the UI sends no pad notes at all, so applying it
 *  only where the UI sends (midi/router.ts) left the toggle working on host
 *  tracks and doing nothing anywhere else. Pushed by comparison for the same
 *  reason as the map — including the first push, which states the value rather
 *  than assuming the engine's default. */
export function syncPadRoute(send: (key: string, value: string) => void): void {
    const next = buildMap();
    if (next !== pushed) {
        pushed = next;
        send('padmap', next);
    }
    const vel = seqState.fullVelocity ? '1' : '0';
    if (vel !== pushedVel) {
        pushedVel = vel;
        send('padvel', vel);
    }
}

/** Forget the pushed state. Used on teardown and engine reload — a re-dlopened
 *  engine has no map, and believing otherwise would leave pads dead. */
export function resetPadRoute(): void {
    pushed = '';
    pushedVel = '';
}
