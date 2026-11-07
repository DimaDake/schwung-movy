/* Reads the Set for a generator request: one track's clips per call (`ait:<t>`, a
 * blocking get, so job.ts spreads the 16 reads over 16 ticks) plus what the
 * track's synth model knows about its module and drum voices. */

import { appState, trackIsDrum } from '../app/state.js';
import { paramGet } from '../host/param.js';
import { keyboardState } from '../keyboard/state.js';
import { SCALES } from '../seq/scales.js';
import { seqState } from '../seq/state.js';
import { parseTrackDump, TICKS_PER_STEP, type AiClip } from './clip-dump.js';
import { pcName } from './harmony.js';
import { padHints } from './pad-labels.js';

export interface AiTrackInput {
    index: number;
    name: string;
    module: string;
    drum: boolean;
    padNames: Record<number, string> | null;   // pitch → declared voice name
    padRoles?: Record<number, string> | null;  // pitch → declared role ("kick", "hihat_open")
    padLabels?: Record<number, string> | null; // pitch → what the pad holds (a sample, a voice's algorithm)
    pads?: number[];                           // the rack's pad notes (New Clip on an empty kit)
    clips: AiClip[];
}

export function readTrack(t: number): AiTrackInput {
    const model = appState.trackModels[t]?.[1];
    return {
        index: t,
        name: `Track ${t + 1}`,
        module: model?.getModuleName() ?? '',
        drum: trackIsDrum(t),
        ...(trackIsDrum(t) ? padHints(t) : { padNames: null }),
        pads: rackPads(t),
        clips: parseTrackDump(t, paramGet('ait:' + t) ?? '').map(windowed),
    };
}

function rackPads(t: number): number[] | undefined {
    const cfg = appState.trackModels[t]?.[1]?.getDrumConfig();
    if (!cfg) return undefined;
    return cfg.padNotes?.length ? [...cfg.padNotes] : Array.from({ length: Math.min(64, cfg.padCount) }, (_, i) => cfg.padNoteStart + i);
}

/* What plays is the loop window, and a preview writes its clip from step 0
 * (aiclip): so the generators see only the window, rebased to 0, in the
 * time base they answer in. Parked notes stay with ORIG. */
function windowed(c: AiClip): AiClip {
    const w0 = c.loopStart * TICKS_PER_STEP;
    const w1 = w0 + c.len * TICKS_PER_STEP;
    return { ...c, loopStart: 0,
        notes: c.notes.filter((n) => n.tick >= w0 && n.tick < w1).map((n) => ({ ...n, tick: n.tick - w0 })) };
}

/** Pads a drum option may use: every pitch the track already plays plus every
 *  pad the kit says something about. */
export function kitPads(t: AiTrackInput): number[] {
    const pads = new Set(t.clips.flatMap((c) => c.notes.map((n) => n.pitch)));
    for (const said of [t.padNames, t.padRoles, t.padLabels]) for (const p of Object.keys(said ?? {})) pads.add(Number(p));
    return [...pads];
}

export function setHeader(): { bpm: number; swing: number; root: string; mode: string } {
    return {
        bpm: seqState.bpmX100 / 100,
        swing: seqState.swingPct,
        root: pcName(keyboardState.rootPc),
        mode: (SCALES[keyboardState.scale]?.name ?? 'Major').toLowerCase(),
    };
}
