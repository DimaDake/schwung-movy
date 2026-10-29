/* A session's generators answer the Set as it was when they ran (the other
 * tracks' harmony, a Variation's source clip). Parked, the rest of the Set can
 * change under it, so a resume reads the Set again, one track per tick as the
 * job does, and if anything but the session's own clip moved, later knob
 * turns answer the new Set. The options as they stand are kept: they are what
 * was heard, and may carry hand edits. */

import { mlog } from '../log.js';
import { prepare } from '../gen/engine.js';
import type { AiClip } from './clip-dump.js';
import { readTrack, type AiTrackInput } from './set-input.js';
import { knobsCtx, knobsRecontext } from './preview-knobs.js';

const TRACKS = 16;

interface Refresh { track: number; slot: number; next: number; tracks: AiTrackInput[] }
let r: Refresh | null = null;

export function refreshStart(track: number, slot: number): void {
    r = knobsCtx() ? { track, slot, next: 0, tracks: [] } : null;
}

export function refreshStop(): void { r = null; }

/* The session's own clip holds an option now, not what the generators read:
 * the read keeps the old one. */
function withOwnClip(fresh: AiTrackInput[], old: AiTrackInput[], track: number, slot: number): AiTrackInput[] {
    const before = old.find((t) => t.index === track)?.clips.find((c) => c.slot === slot);
    return fresh.map((t) => {
        if (t.index !== track) return t;
        const clips: AiClip[] = t.clips.filter((c) => c.slot !== slot);
        if (before) clips.push(before);
        return { ...t, clips: clips.sort((a, b) => a.slot - b.slot) };
    });
}

const sigOf = (ts: AiTrackInput[]): string =>
    JSON.stringify(ts.map((t) => [t.index, t.drum, t.clips.map((c) => [c.slot, c.len, c.notes])]));

/** Per tick while a resumed session is open. */
export function refreshTick(): void {
    if (!r) return;
    const t = readTrack(r.next++);
    if (t.clips.length || t.index === r.track) r.tracks.push(t);
    if (r.next < TRACKS) return;
    const c = knobsCtx();
    const { track, slot, tracks } = r;
    r = null;
    if (!c) return;
    const merged = withOwnClip(tracks, c.input.tracks, track, slot);
    if (sigOf(merged) === sigOf(c.input.tracks)) return;
    mlog(`ai: t${track} s${slot} the Set moved while parked; knobs follow it`);
    knobsRecontext(prepare({ ...c.input, tracks: merged }));
}
