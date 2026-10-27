/* Note-set similarity shared by case cutting and scoring. Notes are compared
 * on the 16th grid (step) and by pitch: two takes "match" where they put the
 * same pitch on the same step, so timing feel alone never counts as a change. */

export const STEP = 24;

export const cell = (n) => `${Math.round(n.tick / STEP)}:${n.pitch}`;

/** 0 = the same (step, pitch) set, 1 = nothing in common. */
export function difference(a, b) {
    const A = new Set(a.map(cell)), B = new Set(b.map(cell));
    if (!A.size && !B.size) return 0;
    let both = 0;
    for (const x of A) if (B.has(x)) both++;
    return 1 - both / (A.size + B.size - both);
}

/** Notes starting in [start, start + len) ticks, rebased to 0 and trimmed. */
export function window(notes, start, len) {
    return notes.filter((n) => n.tick >= start && n.tick < start + len)
        .map((n) => ({ ...n, tick: n.tick - start, gate: Math.max(1, Math.min(n.gate, start + len - n.tick)) }));
}

export const onGridShare = (notes) => (notes.length ? notes.filter((n) => n.tick % STEP === 0).length / notes.length : 0);
