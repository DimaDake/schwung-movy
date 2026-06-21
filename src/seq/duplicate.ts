/* Unified duplicate gesture (Copy button, CC 60): hold → press source → press
 * destination, REPLACING the destination. One gesture across views — the unit
 * is a clip (Session), a step (Note view) or a bar (Loop view). The source
 * stays armed while Copy is held, so it can be stamped to several destinations.
 * The engine owns the clipboard; this module only emits commands + toasts. */

import { seqCmd, requestLabelSync } from './engine.js';
import { seqToast } from './render.js';

export type DupUnit =
    | { kind: 'clip'; track: number; slot: number }
    | { kind: 'step'; track: number; step: number }
    | { kind: 'bar'; track: number; bar: number };

let held = false;
let source: DupUnit | null = null;

export function dupActive(): boolean {
    return held;
}

/* Copy button down/up. Down begins a fresh gesture; up ends it. */
export function copyButton(down: boolean): void {
    held = down;
    source = null;
}

/* A unit (clip/step/bar) pressed while the Copy button is held. The first press
 * captures the source; later presses paste-replace at the destination, keeping
 * the source armed for more destinations. */
export function onUnit(u: DupUnit): void {
    if (!held) return;
    if (source === null) {
        source = u;
        copySource(u);
        seqToast('Copied');
    } else {
        pasteTo(u);
        seqToast('Pasted');
    }
}

function copySource(u: DupUnit): void {
    if (u.kind === 'clip') seqCmd(`clipcopy ${u.track} ${u.slot}`);
    else if (u.kind === 'step') seqCmd(`cpy ${u.track} ${u.step} ${u.step}`);
    else seqCmd(`cpy ${u.track} ${u.bar * 16} ${u.bar * 16 + 15}`);
}

function pasteTo(dest: DupUnit): void {
    if (dest.kind === 'clip') { seqCmd(`clippaste ${dest.track} ${dest.slot}`); requestLabelSync(); }
    else if (dest.kind === 'step') seqCmd(`pst ${dest.track} ${dest.step}`);
    else seqCmd(`pst ${dest.track} ${dest.bar * 16}`);
}

export function resetDuplicate(): void {
    held = false;
    source = null;
}
