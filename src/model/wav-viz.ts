/* Detects a sample waveform group: a `wav_position` marker param and, when the
 * module puts one on the same page, its `file` companion. The graphic replaces
 * both cells — the waveform IS the sample and the marker IS the position, so a
 * filename string and a percentage arc say strictly less than the picture.
 * Pure: indices only, no I/O and no rendering. */

import type { KnobParam } from '../types/param.js';

export type MarkerKind = 'position' | 'loopStart' | 'loopEnd';

export interface WavMarker { idx: number; kind: MarkerKind }

export interface WavGroup {
    position: number;        // page-relative index of the primary marker
    file: number | null;     // its sample-file companion on this page, if any
    markers: WavMarker[];    // every marker on the same sample, primary first
}

/* Index of the file param a marker names, or -1. */
const declaredFile = (params: (KnobParam | null)[], p: KnobParam): number =>
    p.filepathParam ? params.findIndex((q) => q?.key === p.filepathParam) : -1;

/* A marker is either typed `wav_position`, or a plain number that NAMES the
 * file it indexes. mrsample types its Start and Loop Start as floats and says
 * `filepath_param: sample_path`; the declaration is the module telling us this
 * knob is a position into that sample, and it is a stronger signal than the
 * type string. */
function isMarker(params: (KnobParam | null)[], p: KnobParam): boolean {
    if (p.uiType === 'wav_position') return true;
    if (p.type !== 'float' && p.type !== 'int') return false;
    return declaredFile(params, p) >= 0;
}

/* Loop bounds are drawn as brackets rather than a cursor, so they have to be
 * told apart from the playback position. Named, like everything else movy
 * infers: a marker that says "loop" and "end" is the closing bracket. */
function markerKind(p: KnobParam): MarkerKind {
    const t = (p.key + ' ' + p.label).toLowerCase();
    if (!/\bloop|\bloop_/.test(t) && !t.includes('loop')) return 'position';
    if (/end|stop|finish|to\b/.test(t)) return 'loopEnd';
    return 'loopStart';
}

export function detectWavViz(params: (KnobParam | null)[]): WavGroup[] {
    let position = -1;
    params.forEach((p, i) => {
        if (p && position < 0 && isMarker(params, p) && markerKind(p) === 'position') position = i;
    });
    /* All-loop pages (no playback cursor) still deserve the graphic. */
    if (position < 0) params.forEach((p, i) => {
        if (p && position < 0 && isMarker(params, p)) position = i;
    });
    if (position < 0) return [];

    /* Prefer the module's OWN declaration of which file this marker indexes
     * over "the first file param on the page" — a page holding both a preset
     * path and a sample path would otherwise be a coin toss. */
    const marker = params[position] as KnobParam;
    let file: number | null = null;
    const declared = declaredFile(params, marker);
    if (declared >= 0) file = declared;
    else params.forEach((p, i) => { if (file === null && p?.type === 'file') file = i; });

    /* Every other marker on the SAME sample joins the graphic — schwung's own
     * `view_group` when the module declares one (mrsample groups Start, Loop
     * Start and Loop End as "loop"), otherwise anything naming the same file.
     * They belong on one picture: three separate knobs cannot show that a loop
     * sits inside the region that plays. */
    const group = marker.viewGroup;
    const markers: WavMarker[] = [{ idx: position, kind: markerKind(marker) }];
    params.forEach((p, i) => {
        if (!p || i === position || !isMarker(params, p)) return;
        const sameGroup = group && p.viewGroup === group;
        const sameFile = file !== null && declaredFile(params, p) === file;
        if (sameGroup || sameFile) markers.push({ idx: i, kind: markerKind(p) });
    });
    return [{ position, file, markers }];
}
