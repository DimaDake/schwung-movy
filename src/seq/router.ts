/* First-look dispatcher for sequencer-owned input. midi/router.ts calls
 * this before any existing handler; returning true consumes the event, so
 * the param-page layer stays untouched by sequencer features.
 *
 * Owned: step buttons (notes 16-31), Play, and — while the engine is ready —
 * Left/Right arrows (bar navigation, native behavior; param page/chain nav
 * stays on the jog wheel). Track buttons are observed (watched-clip
 * retarget) without being claimed, so the param-page track switch still
 * runs. */

import {
    CC_NOTE_SESSION, CC_PLAY, CC_REC, CC_TRACK_END, CC_TRACK_START,
    NUM_STEP_BUTTONS, PAD_MAX, PAD_MIN, STEP_NOTE_BASE,
} from './constants.js';

const CC_MUTE = 88;

let muteHeldState = false;
export function setMuteHeld(down: boolean): void { muteHeldState = down; }
export function muteHeld(): boolean { return muteHeldState; }

/* Toggle a track's mute via the engine (mirror flips optimistically so the
 * track button dims this tick). */
export function muteTrack(track: number): void {
    if (track < 0 || track > 3) return;
    const next = seqState.muted[track] ? 0 : 1;
    seqState.muted[track] = next === 1;
    seqCmd('mute ' + track + ' ' + next);
}
import {
    copyActive, copyButton, copyMarkStep, deleteActive, deleteButton, deletePad,
    deleteStep, pasteArmed, pasteAtStep,
} from './edit-ops.js';
import { engineReady, seqCmd } from './engine.js';
import {
    doubleLoop, loopButton, loopHeld, loopStepOff, loopStepOn, loopWheel,
} from './loop-mode.js';
import { momentaryDown, momentaryGesture, momentaryUp } from './momentary.js';
import {
    anyStepHeld, editLength, editNudge, editPad, editStepDown, editStepUp,
    editTranspose, editVelocity, heldStepAbs, setLengthTo,
} from './step-edit.js';
import { seqToast } from './render.js';
import {
    sessionCopyButton, sessionDeleteButton, sessionPad, sessionToggle,
} from './session.js';
import {
    maxBarOffset, occHasStep, occToggleStep, seqState,
} from './state.js';
import { setHeldSet } from './held.js';

const CC_LEFT = 62;
const CC_RIGHT = 63;
const CC_LOOP = 58;
const CC_WHEEL = 14;     // MoveMainKnob — wheel
const CC_VOLUME = 79;    // MoveMaster — Volume encoder
const CC_PLUS = 55;      // MoveUp / +
const CC_MINUS = 54;     // MoveDown / -
const CC_COPY = 60;
const CC_DELETE = 119;
const STEP_METRO = 5;     // Step 6  — Shift+Step 6  = Metronome
const STEP_FULL_VEL = 9;  // Step 10 — Shift+Step 10 = Full Velocity
const STEP_DOUBLE_LOOP = 14; // Step 15 — Shift+Step 15 = Double Loop
const STEP_QUANTIZE = 15; // Step 16 — Shift+Step 16 = Quantize

/* Pads currently held, padNote → midiNote, for chord step entry. Mirrors the
 * pads physically down so a step press can place the whole chord. */
const heldChord = new Map<number, number>();

/* Session view state before the Note/Session button's current press, so a tap
 * can decide latch-vs-toggle-off and a hold can revert. */
let sessionPrev = false;

export function seqHandleMidi(data: number[], shiftHeld: boolean): boolean {
    const statusType = data[0] & 0xF0;
    const d1 = data[1];
    const d2 = data[2];

    /* Session mode owns the 32 pads as the clip grid. */
    if (seqState.sessionMode
        && (statusType === 0x90 || statusType === 0x80)
        && d1 >= PAD_MIN && d1 <= PAD_MAX) {
        if (statusType === 0x90 && d2 > 0) {
            momentaryGesture(); // launching a clip while Session is held = temporary peek
            sessionPad(d1, PAD_MIN);
        }
        return true;
    }

    /* Step buttons. A press registers a held range (for hold-step editing)
     * and, in the relevant mode, also drives note toggle / bar select. The
     * note toggle fires on RELEASE so a held step + gesture can edit instead
     * of toggling (native behavior). Shift+step are the shifted functions. */
    if ((statusType === 0x90 || statusType === 0x80)
        && d1 >= STEP_NOTE_BASE && d1 < STEP_NOTE_BASE + NUM_STEP_BUTTONS) {
        const button = d1 - STEP_NOTE_BASE;
        const on = statusType === 0x90 && d2 > 0;
        if (on && copyActive()) {
            copyMarkStep(button);
        } else if (on && deleteActive()) {
            deleteStep(button);
        } else if (on && pasteArmed()) {
            pasteAtStep(button);
        } else if (on && shiftHeld) {
            shiftStepFunction(button);
        } else if (on) {
            const absB = seqState.barOffset * NUM_STEP_BUTTONS + button;
            // The hold-A + press-B length gesture (and the held-step note
            // overlay) are melodic-only. On a drum lane each step press is
            // independent, so holding one step never blocks entering others.
            if (!seqState.loopMode && seqState.watchLane < 0
                && heldStepAbs() >= 0 && absB !== heldStepAbs()
                && setLengthTo(absB)) {
                // length gesture consumed; do not register B as a held step
            } else {
                editStepDown(button);
                if (seqState.loopMode) loopStepOn(button);
                if (!seqState.loopMode && seqState.watchLane < 0 && heldStepAbs() >= 0) {
                    seqState.holdStep = heldStepAbs();
                    seqState.holdNotes = [];
                    seqCmd('hold ' + seqState.watchTrack + ' ' + seqState.holdStep);
                }
            }
        } else {
            const wasTap = editStepUp(button);
            if (!anyStepHeld()) {
                if (seqState.holdNotes.length > 0) {
                    setHeldSet(seqState.watchTrack, seqState.holdNotes);
                    seqState.lastPitch[seqState.watchTrack] = seqState.holdNotes[0];
                }
                seqState.holdNotes = [];
                seqState.holdStep = -1;
                seqState.holdLen = 0;
                seqCmd('hold ' + seqState.watchTrack + ' -1');
            }
            if (seqState.loopMode) loopStepOff(button);
            else if (wasTap) toggleStep(button);
        }
        return true;
    }

    if (statusType !== 0xB0) return false;

    /* Mute button: held state gates track-button mute gesture (midi/router.ts). */
    if (d1 === CC_MUTE) {
        setMuteHeld(d2 > 0);
        return true;
    }

    /* Loop button: tap toggles Loop Mode; hold + wheel resizes the loop. */
    if (d1 === CC_LOOP) {
        loopButton(d2 > 0);
        return true;
    }

    /* Note/Session: momentary. Down shows Session; a clean tap latches (or
     * toggles back to Note if already in Session); a hold or any clip launch
     * while held reverts to the prior view on release. */
    if (d1 === CC_NOTE_SESSION) {
        if (d2 > 0) {
            sessionPrev = seqState.sessionMode;
            momentaryDown(d1, () => { seqState.sessionMode = sessionPrev; });
            seqState.sessionMode = true;
        } else if (momentaryUp(d1) === 'tap' && sessionPrev) {
            seqState.sessionMode = false; // tap while already in Session → back to Note
        }
        return true;
    }

    /* Copy/Delete: in Session mode they act on clips by pad; otherwise the
     * Note-mode step/clip gestures (edit-ops). */
    if (d1 === CC_COPY) {
        if (seqState.sessionMode) sessionCopyButton(d2 > 0);
        else copyButton(d2 > 0);
        return true;
    }
    if (d1 === CC_DELETE) {
        if (seqState.sessionMode) sessionDeleteButton(d2 > 0);
        else deleteButton(d2 > 0);
        return true;
    }

    /* Rec: toggle recording (engine arms a one-bar count-in). */
    if (d1 === CC_REC) {
        if (d2 > 0) {
            seqCmd('rec ' + seqState.watchTrack);
            seqToast(seqState.recording ? 'Stop' : 'Record');
        }
        return true;
    }

    /* Volume encoder edits held steps' velocity; otherwise not ours. */
    if (d1 === CC_VOLUME) {
        return editVelocity(decodeDelta(d2));
    }

    /* Wheel: held-step length edit first, then Loop+wheel resize; otherwise
     * falls through to the param page/chain nav. */
    if (d1 === CC_WHEEL) {
        if (editLength(decodeDelta(d2))) return true;
        if (loopHeld()) return loopWheel(decodeDelta(d2));
        return false;
    }

    if (d1 === CC_PLAY) {
        if (d2 > 0) {
            seqCmd(seqState.playing ? 'stop' : 'play');
            seqState.playing = !seqState.playing;
        }
        return true;
    }

    /* +/- buttons transpose held steps; otherwise fall through to octave. */
    if ((d1 === CC_PLUS || d1 === CC_MINUS) && d2 > 0 && anyStepHeld()) {
        return editTranspose(d1 === CC_PLUS ? 1 : -1);
    }

    /* Left/Right: nudge held steps; else bar navigation (engine ready); else
     * fall through to the existing param page/chain nav. */
    if ((d1 === CC_LEFT || d1 === CC_RIGHT) && d2 > 0) {
        const dir = d1 === CC_RIGHT ? 1 : -1;
        if (anyStepHeld()) return editNudge(dir, shiftHeld);
        if (engineReady()) { navigateBar(dir); return true; }
        return false;
    }

    /* Track buttons: observe only — retarget the watched clip and let the
     * existing param-page track switching run unchanged. */
    if (d1 >= CC_TRACK_START && d1 <= CC_TRACK_END && d2 > 0) {
        const track = CC_TRACK_END - d1;
        if (track !== seqState.watchTrack) {
            seqState.watchTrack = track;
            seqState.barOffset = 0;
            seqCmd('watch ' + track);
        }
        return false;
    }

    return false;
}

/* Shift + step button = Move's shifted step functions. Step 10 toggles Full
 * Velocity; further entries (Double Loop = Step 15, Quantize = Step 16) land
 * in later steps. */
function shiftStepFunction(step: number): void {
    if (step === STEP_FULL_VEL) {
        seqState.fullVelocity = !seqState.fullVelocity;
        seqToast(seqState.fullVelocity ? 'Full Velocity On' : 'Full Velocity Off');
    } else if (step === STEP_DOUBLE_LOOP) {
        doubleLoop();
    } else if (step === STEP_METRO) {
        seqCmd('metro ' + (seqState.metro ? 0 : 1));
        seqToast(seqState.metro ? 'Metronome Off' : 'Metronome On');
    } else if (step === STEP_QUANTIZE) {
        seqCmd('quant ' + seqState.watchTrack);
        seqToast('Quantized');
    }
}

function navigateBar(delta: number): void {
    const next = Math.max(0, Math.min(seqState.barOffset + delta, maxBarOffset()));
    seqState.barOffset = next;
}

function toggleStep(button: number): void {
    const step = seqState.barOffset * NUM_STEP_BUTTONS + button;
    const t = seqState.watchTrack;
    const wasSet = occHasStep(step);

    if (seqState.watchLane >= 0) {
        /* Drum lane: toggle just the selected lane's pitch at this step. */
        seqCmd(`ltog ${t} ${step} ${seqState.watchLane} ${seqState.lastVel[t]}`);
    } else {
        /* Melodic: place the currently-held chord, or the last-played note
         * if no pads are down; a step that already has notes is cleared. */
        const pitches = heldChord.size > 0
            ? [...heldChord.values()]
            : [seqState.lastPitch[t]];
        const v = seqState.lastVel[t];
        seqCmd(`tog ${t} ${step} ${pitches.map((p) => `${p} ${v}`).join(' ')}`);
    }

    /* Optimistic mirror so the step LED flips this tick. Adding the first
     * note auto-starts the transport and implicitly creates a 1-bar clip. */
    if (!wasSet) {
        if (seqState.lenSteps === 0) seqState.lenSteps = NUM_STEP_BUTTONS;
        if (step >= seqState.lenSteps) {
            seqState.lenSteps = (Math.floor(step / NUM_STEP_BUTTONS) + 1) * NUM_STEP_BUTTONS;
        }
        if (!seqState.playing) seqState.playing = true;
    }
    occToggleStep(step);
}

/* Pad note-on: remember the active track's last-played note (step-entry
 * value). If a step is held, the pad edits that step's notes (hold-step +
 * pad gesture) instead of joining the held chord. */
export function seqNotePadPlayed(track: number, padNote: number, midiNote: number, vel: number): void {
    if (track >= 0 && track < 4) {
        seqState.lastPitch[track] = midiNote;
        seqState.lastVel[track] = vel;
    }
    if (deleteActive()) {
        deletePad(midiNote); // hold Delete + pad clears that pitch
        return;
    }
    if (anyStepHeld()) {
        editPad(midiNote, vel);
        return;
    }
    heldChord.set(padNote, midiNote);
    setHeldSet(track, [...heldChord.values()]);
    /* Forward to the engine for recording capture. The UI already sounded the
     * note directly (zero latency); the engine only records (no double note),
     * and ignores it unless armed. */
    if (engineReady()) seqCmd(`non ${track} ${midiNote} ${vel}`);
}

/* Pad note-off: drop it from the held chord and end any recording capture. */
export function seqNotePadReleased(padNote: number): void {
    const midiNote = heldChord.get(padNote);
    heldChord.delete(padNote);
    if (midiNote !== undefined && engineReady()) {
        seqCmd(`nof ${seqState.watchTrack} ${midiNote}`);
    }
}

/* Restore the watch target after a momentary track-button hold reverts.
 * Resets barOffset to 0 since the saved offset was wiped when switching away. */
export function seqRestoreWatch(track: number): void {
    seqState.watchTrack = track;
    seqState.barOffset = 0;
    seqCmd('watch ' + track);
}

/* Active module changed: set the watched step-LED lane. lane < 0 = melodic
 * (all notes); lane >= 0 = a drum pad's MIDI note. Emits wlane only on a
 * real change. */
export function seqSetLane(lane: number): void {
    if (lane === seqState.watchLane) return;
    seqState.watchLane = lane;
    seqState.barOffset = 0;
    seqCmd('wlane ' + (lane < 0 ? -1 : lane));
}
