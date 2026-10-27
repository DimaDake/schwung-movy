/* Reads the Set for an AI request: one track's clips per call (`ait:<t>`, a
 * blocking get, so job.ts spreads the 16 reads over 16 ticks) plus what the
 * track's synth model knows about its module and drum voices. */

import { appState, trackIsDrum } from '../app/state.js';
import { paramGet } from '../host/param.js';
import { keyboardState } from '../keyboard/state.js';
import { SCALES } from '../seq/scales.js';
import { seqState } from '../seq/state.js';
import { parseTrackDump, TICKS_PER_STEP, type AiClip } from './clip-dump.js';
import type { AiTrackInput } from './context.js';
import { pcName } from './harmony.js';

function padNames(t: number): Record<number, string> | null {
    const model = appState.trackModels[t]?.[1];
    const cfg = model?.getDrumConfig();
    const names = model?.getDrumPadNames() ?? [];
    if (!cfg || !names.some((n) => n)) return null;
    const out: Record<number, string> = {};
    names.forEach((n, i) => {
        if (n) out[cfg.padNotes?.[i] ?? cfg.padNoteStart + i] = n.toUpperCase();
    });
    return out;
}

export function readTrack(t: number): AiTrackInput {
    const model = appState.trackModels[t]?.[1];
    return {
        index: t,
        name: `Track ${t + 1}`,
        module: model?.getModuleName() ?? '',
        drum: trackIsDrum(t),
        padNames: padNames(t),
        clips: parseTrackDump(t, paramGet('ait:' + t) ?? '').map(windowed),
    };
}

/* What plays is the loop window, and a preview writes its clip from step 0
 * (aiclip): so the model sees only the window, rebased to 0, in the same
 * time base it is asked to answer in. Parked notes stay with ORIG. */
function windowed(c: AiClip): AiClip {
    const w0 = c.loopStart * TICKS_PER_STEP;
    const w1 = w0 + c.len * TICKS_PER_STEP;
    return { ...c, loopStart: 0,
        notes: c.notes.filter((n) => n.tick >= w0 && n.tick < w1).map((n) => ({ ...n, tick: n.tick - w0 })) };
}

/** Pads a drum option may use: every pitch the track already plays plus the
 *  kit's declared voices. */
export function kitPads(t: AiTrackInput): number[] {
    const pads = new Set(t.clips.flatMap((c) => c.notes.map((n) => n.pitch)));
    for (const p of Object.keys(t.padNames ?? {})) pads.add(Number(p));
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
