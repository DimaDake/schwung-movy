/* A clean part played the way people play it: timing drift taken from a real
 * drummer's deviations from the grid (Groove MIDI) rather than uniform noise,
 * a few slips to a neighbouring key, uneven velocity, and one dropped or
 * doubled note. Seeded, so a case is the same on every run. */

export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** deviations: movy ticks off the grid, cycled over the notes. */
export function messify(notes, deviations, seed, { slip = 0.08, drum = false } = {}) {
    const r = rng(seed);
    const dev = deviations.length ? deviations : [0];
    const off = Math.floor(r() * dev.length);
    let out = notes.map((n, i) => {
        const pitch = !drum && r() < slip ? n.pitch + (r() < 0.5 ? -1 : 1) : n.pitch;
        return {
            tick: Math.max(0, n.tick + dev[(i + off) % dev.length]),
            gate: Math.max(1, Math.round(n.gate * (0.7 + r() * 0.6))),
            pitch,
            vel: Math.min(127, Math.max(1, Math.round(n.vel * (0.7 + r() * 0.45)))),
        };
    });
    if (out.length > 2) {
        const k = 1 + Math.floor(r() * (out.length - 2));
        if (r() < 0.5) out.splice(k, 1);
        else out.splice(k, 0, { ...out[k], tick: out[k].tick + 4 + Math.floor(r() * 8), vel: Math.max(1, out[k].vel >> 1) });
    }
    return out.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}
