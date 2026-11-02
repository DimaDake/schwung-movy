/* A generator session's steps (plans/2026-11-01-generator-ux-design.md §2.4):
 * each a snapshot of what the preview shows — the option on screen, every
 * option's notes and knobs — so undo and redo swap notes back in place, no
 * regeneration. Below the first step is ORIG, below that the session closes. */

import type { AiNote } from './clip-dump.js';

export interface Snap { index: number; options: AiNote[][]; knobs: number[][] }

export const SESSION_CAP = 128;

export class SessionUndo {
    private states: Snap[] = [];
    private at = -1;            // -1: ORIG, below the first step

    start(s: Snap): void { this.states = [s]; this.at = 0; }

    /** A new step; what was undone past it is gone. Past the cap the oldest
     *  after the first merge into it (the first stays the session's start). */
    push(s: Snap): void {
        this.states = this.states.slice(0, this.at + 1);
        this.states.push(s);
        if (this.states.length > SESSION_CAP) this.states.splice(1, 1);
        this.at = this.states.length - 1;
    }

    /** The step to show, 'orig' below the first, 'close' below ORIG. */
    undo(): Snap | 'orig' | 'close' {
        if (this.at > 0) return this.states[--this.at];
        if (this.at === 0) { this.at = -1; return 'orig'; }
        return 'close';
    }

    redo(): Snap | null { return this.at < this.states.length - 1 ? this.states[++this.at] : null; }

    top(): Snap | null { return this.states[this.at] ?? null; }
    size(): number { return this.states.length; }
}
