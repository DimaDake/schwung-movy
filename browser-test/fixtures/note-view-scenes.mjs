/* Loop-mode note view screenshot scenes — the six cases of the approved mock
 * (plans/2026-10-18-loop-note-view.md). Notes are { tick, gate, pitch } in
 * engine ticks (24 per step); gate 0 is a held recording note. */

const S = 24;
const n = (step, steps, pitch) => ({ tick: step * S, gate: steps * S, pitch });

function bass() {
    const seq = [36, 36, 43, 36, 48, 36, 46, 43, 36, 36, 43, 36, 48, 46];
    const len = [1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1];
    const out = [];
    let s = 0;
    seq.forEach((p, i) => { out.push(n(s, len[i], p)); s += len[i]; });
    return out;
}

function chords() {
    const prog = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
    const out = [];
    prog.forEach((c, b) => c.forEach((p) => out.push(n(b * 16, 16, p))));
    [67, 69, 72, 71, 69, 67, 64, 65].forEach((p, i) => out.push(n(i * 8, 6, p)));
    return out;
}

function drums() {
    const out = [];
    for (let bar = 0; bar < 2; bar++) {
        const o = bar * 16;
        for (const s of [0, 6, 10]) out.push(n(o + s, 1, 36));
        for (const s of [4, 12]) out.push(n(o + s, 1, 38));
        for (let s = 0; s < 16; s += 2) out.push(n(o + s, 1, 42));
        out.push(n(o + 14, 2, 46));
    }
    return out;
}

function melody() {
    // Two bars, the last note still held (a take being recorded).
    return [n(0, 3, 60), n(4, 2, 63), n(6, 2, 67), n(8, 4, 70), n(14, 2, 72),
        n(16, 6, 75), n(22, 2, 74), n(24, 4, 70), { tick: 28 * S, gate: 0, pitch: 67 }];
}

function dense() {
    const out = [];
    for (let bar = 0; bar < 16; bar++) {
        const o = bar * 16;
        for (let s = 0; s < 16; s++) out.push(n(o + s, 1, 42));
        for (const s of [0, 8]) out.push(n(o + s, 1, 36));
        for (const s of [4, 12]) out.push(n(o + s, 1, 38));
        out.push(n(o, 16, 50 + (bar % 5)));
    }
    return out;
}

function wide() {
    const out = [];
    for (let i = 0; i < 64; i++) out.push(n(i, 1, 24 + ((i * 13) % 60)));
    return out;
}

export const NOTE_VIEW_SCENES = {
    note_view_bass:   { notes: bass(),   loopStart: 0, lenSteps: 16,  barOffset: 0, posTick: 9 * S },
    note_view_chords: { notes: chords(), loopStart: 0, lenSteps: 64,  barOffset: 1, posTick: 22 * S },
    note_view_drums:  { notes: drums(),  loopStart: 0, lenSteps: 32,  barOffset: 0, posTick: 22 * S },
    note_view_plus:   { notes: melody(), loopStart: 0, lenSteps: 32,  barOffset: 2, posTick: 31 * S },
    note_view_dense:  { notes: dense(),  loopStart: 0, lenSteps: 256, barOffset: 0, posTick: 77 * S },
    note_view_wide:   { notes: wide(),   loopStart: 0, lenSteps: 64,  barOffset: 0, posTick: 51 * S },
};
