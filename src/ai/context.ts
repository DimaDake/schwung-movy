/* The whole Set as text for the model (design §4 and §9 "Context"): every
 * clip of every track, a track's duplicate clips once, the harmony map per
 * scene, and the target/source flagged. Only past the ceiling do scenes other
 * than the target's and the source's shrink to their harmony line. */

import { type AiClip, type AiNote, TICKS_PER_STEP, STEPS_PER_BAR } from './clip-dump.js';
import { drumLabel } from './drum-names.js';
import { pcName, sceneHarmony } from './harmony.js';

export interface AiTrackInput {
    index: number;
    name: string;
    module: string;
    drum: boolean;
    padNames: Record<number, string> | null;   // pitch → declared voice name
    clips: AiClip[];
}

export interface AiContextInput {
    bpm: number;
    swing: number;
    root: string;
    mode: string;
    tracks: AiTrackInput[];
    target: { track: number; slot: number };
    source: { track: number; slot: number } | null;
    ceilingBytes?: number;
    units?: 'steps' | 'ticks';   // positions and durations; the reply uses the same (prompt.ts)
}

export const CONTEXT_CEILING = 400_000;

function noteName(p: number): string { return pcName(p) + (Math.floor(p / 12) - 2); }

const num = (v: number) => String(Math.round(v * 100) / 100);

function pos(tick: number): string {
    const step = Math.floor(tick / TICKS_PER_STEP);
    const inBar = step % STEPS_PER_BAR;
    return `${Math.floor(step / STEPS_PER_BAR) + 1}.${Math.floor(inBar / 4) + 1}.${(inBar % 4) + 1}+${tick % TICKS_PER_STEP}`;
}

function noteLines(t: AiTrackInput, notes: AiNote[], steps: boolean): string[] {
    const byBar = new Map<number, string[]>();
    for (const n of [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch)) {
        const bar = Math.floor(n.tick / (TICKS_PER_STEP * STEPS_PER_BAR)) + 1;
        const label = t.drum ? drumLabel(n.pitch, t.padNames) : `${n.pitch}:${noteName(n.pitch)}`;
        if (!byBar.has(bar)) byBar.set(bar, []);
        byBar.get(bar)!.push(steps ? `@${num(n.tick / TICKS_PER_STEP)} ${label} d${num(n.gate / TICKS_PER_STEP)} v${n.vel}`
            : `${pos(n.tick)} ${label} d${n.gate} v${n.vel}`);
    }
    return [...byBar].map(([bar, list]) => `    bar ${bar}: ${list.join(', ')}`);
}

function clipKey(c: AiClip): string {
    return [c.len, c.loopStart, c.scaleNum, c.scaleDen, c.transpose,
        c.notes.map((n) => `${n.tick}.${n.gate}.${n.pitch}.${n.vel}`).join(',')].join('|');
}

function trackLines(t: AiTrackInput, s: AiContextInput, keep: (slot: number) => boolean): string[] {
    const role = t.drum ? 'drums (notes are pitch:voice)' : 'melodic';
    const out = [`TRACK ${t.index + 1} "${t.name}" - module ${t.module || 'none'}, ${role}`];
    const seen = new Map<string, number>();
    const flag = (slot: number) => (s.target.track === t.index && s.target.slot === slot ? ' [TARGET]' : '')
        + (s.source && s.source.track === t.index && s.source.slot === slot ? ' [SOURCE]' : '');
    for (const c of [...t.clips].sort((a, b) => a.slot - b.slot)) {
        const scene = `scene ${c.slot + 1}${flag(c.slot)}`;
        const special = flag(c.slot) !== '';
        const key = clipKey(c);
        if (!special && seen.has(key)) { out.push(`  ${scene}: same as scene ${seen.get(key)! + 1}`); continue; }
        if (!seen.has(key)) seen.set(key, c.slot);
        if (!special && !keep(c.slot)) { out.push(`  ${scene}: harmony only (see HARMONY)`); continue; }
        out.push(`  ${scene}: ${c.len / STEPS_PER_BAR} bars, speed ${c.scaleNum}/${c.scaleDen}, `
            + `transpose ${c.transpose}, loop from step ${c.loopStart + 1}`);
        out.push(...noteLines(t, c.notes, s.units !== 'ticks'));
    }
    if (s.target.track === t.index && !t.clips.some((c) => c.slot === s.target.slot)) {
        out.push(`  scene ${s.target.slot + 1} [TARGET]: empty`);
    }
    return out;
}

function harmonyLines(s: AiContextInput): string[] {
    const slots = [...new Set(s.tracks.flatMap((t) => t.clips.map((c) => c.slot)))].sort((a, b) => a - b);
    const drum = (i: number) => s.tracks.find((t) => t.index === i)?.drum ?? false;
    const out = ['HARMONY (sounding pitch classes and chord per bar, transpose applied)'];
    for (const slot of slots) {
        const clips = s.tracks.flatMap((t) => t.clips.filter((c) => c.slot === slot));
        const flag = (slot === s.target.slot ? ' [TARGET]' : '') + (slot === s.source?.slot ? ' [SOURCE]' : '');
        out.push(`  scene ${slot + 1}${flag}: ${sceneHarmony(clips, drum).join('; ')}`);
    }
    return out;
}

function render(s: AiContextInput, keep: (slot: number) => boolean): string {
    const head = `SET: tempo ${s.bpm} BPM, swing ${s.swing}%, key ${s.root} ${s.mode}, 4/4. `
        + `Time grid: ${STEPS_PER_BAR} steps per bar, ${TICKS_PER_STEP} ticks per step. `
        + (s.units === 'ticks'
            ? 'Positions are bar.beat.sixteenth+ticks; notes are MIDI number:name (60 = C3), d = duration in ticks, v = velocity. '
            : 'Positions are @step from the clip start (16 steps per bar, @0 = bar 1 beat 1; fractions are off-grid feel); '
                + 'notes are MIDI number:name (60 = C3), d = duration in steps, v = velocity. ')
        + 'A scene is one column of clips that play together.';
    const body = s.tracks.filter((t) => t.clips.length || t.index === s.target.track)
        .flatMap((t) => trackLines(t, s, keep));
    return [head, '', ...body, '', ...harmonyLines(s)].join('\n');
}

export function buildContext(s: AiContextInput): string {
    const full = render(s, () => true);
    if (full.length <= (s.ceilingBytes ?? CONTEXT_CEILING)) return full;
    const vital = new Set([s.target.slot, s.source?.slot ?? -1]);
    return render(s, (slot) => vital.has(slot));
}
