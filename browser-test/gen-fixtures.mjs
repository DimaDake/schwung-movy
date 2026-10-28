/* browser-test/gen-fixtures.mjs — small musical Sets for the algorithmic
 * generators' suites: one part per role, in A minor, a scene A (slot 0)
 * playing Am7 | Fmaj7 | Dm7 | E7 over two bars, and a scene B (slot 1) where
 * other tracks either hold chords (locked), a bass alone (partial) or
 * nothing (free). */

const S = 24;
const N = (step, pitch, len = 1, vel = 100) => ({ tick: Math.round(step * S), gate: Math.round(len * S), pitch, vel });
const chord = (step, pitches, len, vel = 96) => pitches.map((p) => N(step, p, len, vel));

const PROG_A = [[57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 60], [52, 56, 59, 62]];   // Am7 Fmaj7 Dm7 E7
const PROG_B = [[53, 57, 60, 64], [55, 59, 62, 65], [57, 60, 64, 67], [52, 56, 59, 62]];   // Fmaj7 G7 Am7 E7

export const PARTS = {
    pad: PROG_A.flatMap((c, i) => chord(i * 8, c, 7.5)),
    stabs: PROG_A.flatMap((c, i) => [...chord(i * 8 + 2, c, 1), ...chord(i * 8 + 6, c, 1)]),
    bass: PROG_A.flatMap((c, i) => [N(i * 8, c[0] - 12, 2), N(i * 8 + 3, c[0] - 12, 1), N(i * 8 + 6, c[2] - 12, 1)]),
    arpeggio: PROG_A.flatMap((c, i) => Array.from({ length: 8 }, (_, j) => N(i * 8 + j, c[j % 4] + 12, 0.75, 90))),
    lead: [N(0, 76, 2), N(2, 74, 1), N(3, 72, 1), N(4, 69, 3), N(8, 72, 2), N(10, 76, 2), N(12, 77, 4),
        N(16, 74, 2), N(18, 72, 1), N(19, 69, 1), N(20, 72, 4), N(24, 71, 2), N(26, 68, 2), N(28, 69, 4)],
    drone: [N(0, 57, 15.5), N(16, 57, 15.5)],
    /* A lead that plays two notes at times (what HARMONIZE needs). */
    duet: [N(0, 76, 2), N(0, 72, 2), N(2, 74, 1), N(3, 72, 1), N(4, 69, 3), N(4, 65, 3), N(8, 72, 2), N(10, 76, 2),
        N(12, 77, 4), N(12, 72, 4), N(16, 74, 2), N(18, 72, 1), N(20, 72, 4), N(20, 69, 4), N(24, 71, 2), N(28, 69, 4), N(28, 64, 4)],
};

export const DRUMS = [0, 4, 8, 12, 16, 20, 24, 28].flatMap((s) => [N(s, 36, 0.5, 115)])
    .concat([4, 12, 20, 28].map((s) => N(s, 38, 0.5, 105)))
    .concat(Array.from({ length: 16 }, (_, i) => N(i * 2, 42, 0.5, i % 2 ? 70 : 90)))
    .concat([N(14, 46, 0.5, 85), N(30, 46, 0.5, 85)]);

/* The drums the other tracks play: hats pushed late on the off-16ths, so the
 * scene has a pocket for TIMING and POCKET to land in. */
const SWUNG = DRUMS.map((n) => (Math.round(n.tick / S) % 2 === 1 ? { ...n, tick: n.tick + 6 } : n))
    .concat([1, 5, 9, 13, 17, 21, 25, 29].map((s) => N(s, 42, 0.5, 60)).map((n) => ({ ...n, tick: n.tick + 6 })));

const clip = (track, slot, notes, len = 32) => ({ track, slot, len, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes });

/** A Set: track 0 is the part under test; `scene` says what the others play in B. */
export function fixtureInput(role, { task = 'variation', scene = 'locked', level = 'BALANCED' } = {}) {
    const drum = role === 'drums';
    const part = drum ? DRUMS : PARTS[role];
    const me = { index: 0, name: 'Track 1', module: drum ? 'drumrack' : 'obxd', drum,
        padNames: drum ? { 36: 'KICK', 38: 'SNARE', 42: 'CLOSED HAT', 46: 'OPEN HAT', 45: 'LOW TOM', 48: 'HIGH TOM', 37: 'RIM' } : null,
        clips: [clip(0, 0, part)] };
    const keys = { index: 1, name: 'Track 2', module: 'obxd', drum: false,
        clips: [clip(1, 0, PROG_A.flatMap((c, i) => chord(i * 8, c, 7.5))),
            ...(scene === 'locked' ? [clip(1, 1, PROG_B.flatMap((c, i) => chord(i * 8, c, 7.5)))] : [])] };
    const bass = { index: 2, name: 'Track 3', module: 'obxd', drum: false,
        clips: [clip(2, 0, PROG_A.map((c, i) => N(i * 8, c[0] - 24, 7))),
            ...(scene !== 'free' ? [clip(2, 1, PROG_B.map((c, i) => N(i * 8, c[0] - 24, 7)))] : [])] };
    const drums = { index: 3, name: 'Track 4', module: 'drumrack', drum: true, clips: [clip(3, 0, SWUNG), clip(3, 1, SWUNG)] };
    /* A double stays in scene A, so there `scene` says who else plays in A. */
    const dbl = task === 'double';
    const others = dbl ? (scene === 'locked' ? [keys, bass] : scene === 'partial' ? [bass] : []) : [keys, bass];
    const tracks = drum ? [me, ...others] : [me, ...others, drums];
    const own = task !== 'variation';
    return { task, level, tracks, target: { track: 0, slot: own ? 0 : 1 }, source: own ? null : { track: 0, slot: 0 },
        len: dbl ? 64 : 32, scale: [1, 1], drum, kit: drum ? [36, 37, 38, 42, 45, 46, 48] : [], root: 'A', mode: 'minor' };
}

/** The part played the way people play it: every onset off by a few ticks,
 *  a couple of neighbouring keys hit by mistake, one note doubled — what
 *  Smart Quantize is for. */
export function messy(notes) {
    const out = notes.map((n, i) => ({ ...n, tick: Math.max(0, n.tick + [5, -4, 7, -6, 3, -8, 6, -3][i % 8]), vel: Math.max(1, n.vel - (i % 3) * 9),
        pitch: i % 5 === 2 ? n.pitch + 1 : n.pitch }));
    if (out.length) out.push({ ...out[0], tick: out[0].tick + 3 });
    /* Two grazes: a neighbour brushed far too quietly to be meant. */
    if (out.length > 3) out.push({ ...out[3], tick: out[3].tick + 30, vel: 14 }, { ...out[1], tick: out[1].tick + 50, vel: 18 });
    return out;
}

export const ROLES = ['pad', 'stabs', 'bass', 'arpeggio', 'lead', 'duet', 'drone', 'drums'];

/** A New Clip request (plans/2026-10-28-new-clip-design.md): track 0 has no
 *  clip at all. `empty` is a Set with nothing else in it either; otherwise
 *  the slot is scene B of fixtureInput, where the others play by `scene`. */
export function createInput(drum, scene, nonce, { len = 32, pad } = {}) {
    if (scene === 'empty') {
        return { task: 'create', level: 'BALANCED', tracks: [{ index: 0, name: 'Track 1', module: drum ? 'drumrack' : 'obxd', drum, padNames: null, clips: [] }],
            target: { track: 0, slot: 1 }, source: null, len, scale: [1, 1], drum, kit: drum ? Array.from({ length: 16 }, (_, i) => 36 + i) : [],
            root: 'C', mode: 'major', nonce, pad };
    }
    const f = fixtureInput(drum ? 'drums' : 'lead', { scene });
    f.tracks[0] = { ...f.tracks[0], clips: [] };
    return { ...f, task: 'create', source: null, len, nonce, pad };
}
