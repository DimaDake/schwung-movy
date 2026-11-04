/* The gestures a HELD group absorbs (group.ts). The AI preview holds one group
 * open; its session hears each gesture inside it end, with what the gesture
 * was, so only an edit of its own clip becomes a step (ai/preview-undo.ts). */

export interface Absorbed { key: string; target?: string; seq?: boolean; once: boolean; idleMs: number; last: number }

const live = new Map<string, Absorbed>();
let told: ((g: Absorbed) => void) | null = null;
export function onAbsorbedGesture(f: ((g: Absorbed) => void) | null): void { told = f; }

/** A gesture's begin, or one more delta of it. */
export function absorbBegin(g: Absorbed): void {
    const was = live.get(g.key);
    if (was) was.last = g.last; else live.set(g.key, g);
}

function end(k: string, g: Absorbed): void { live.delete(k); told?.(g); }

/** `key` ends that gesture. No key is the caller closing what it opened: a
 *  one-shot gesture (a step press, an undoableEdit) never names itself. */
export function absorbEnd(key?: string): void {
    for (const [k, g] of [...live]) if (key === undefined ? g.once : k === key) end(k, g);
}

/* The idle backstop group.ts keeps for a turn whose release never comes (a
 * held step's knobs end on it alone). */
export function absorbIdle(now: number): void {
    for (const [k, g] of [...live]) if (!g.once && now - g.last >= g.idleMs) end(k, g);
}

export function absorbReset(): void { live.clear(); }
