/* The volume knob with no track held, on a host where it is movy's
 * (caps.ownsMasterVolume: no Move beside it to own the master). It drives the
 * engine's master stage (`mfx:vol`, master_chain.rs), which is in the path
 * whenever movy's master is bound — and standalone always binds it (WP3).
 *
 * Same ladder and feel as hold-track+volume (one detent, one dB), topped at
 * unity: the stage clamps there, and a master that boosts would only meet the
 * limiter. The value lives in prefs.json (seq/prefs.ts says why), written once
 * per gesture on release rather than per detent. */

import { mlog } from '../log.js';
import { paramSet } from '../host/param.js';
import { platform } from '../platform/index.js';
import { readPrefMasterVolume, writePrefMasterVolume } from '../seq/prefs.js';
import { ampToIdx, dbFrac, idxToAmp } from './db-ladder.js';

const TOP = ampToIdx(1);
const UNITY_DB = 0;

let idx = -1;          /* ladder position; -1 = not read from prefs yet */
let touched = false;
let unsaved = false;

function current(): number {
    if (idx < 0) idx = Math.min(TOP, ampToIdx(readPrefMasterVolume()));
    return idx;
}

const amp = (): number => idxToAmp(current());

/* Every engine (re)boot: a re-dlopened engine starts at unity. */
export function pushMasterVolume(set: (key: string, value: string) => void): void {
    if (!platform.caps.ownsMasterVolume) return;
    set('mfx:vol', amp().toFixed(4));
}

/* CC 79 with no track held. false = not ours (Move's, beside movy). */
export function masterVolumeKnob(d2: number): boolean {
    if (!platform.caps.ownsMasterVolume) return false;
    const delta = d2 >= 1 && d2 <= 63 ? d2 : d2 >= 65 ? d2 - 128 : 0;
    if (delta === 0) return true;
    idx = Math.min(TOP, Math.max(0, current() + delta));
    paramSet('mfx:vol', amp().toFixed(4));
    unsaved = true;
    mlog('mastervol d=' + delta + ' v=' + amp().toFixed(4));
    return true;
}

export function masterVolumeTouch(on: boolean): void {
    touched = on;
    if (!on && unsaved) {
        writePrefMasterVolume(amp());
        unsaved = false;
    }
}

/* The slider while the knob is touched, on the track gesture's renderer. */
export function masterVolumeOverlay():
    { title: string; value: number; frac: number; unityFrac: number } | null {
    if (!touched || !platform.caps.ownsMasterVolume) return null;
    return { title: 'MASTER VOLUME', value: amp(), frac: dbFrac(amp(), UNITY_DB), unityFrac: 1 };
}

export function resetMasterVolume(): void {
    idx = -1;
    touched = false;
    unsaved = false;
}
