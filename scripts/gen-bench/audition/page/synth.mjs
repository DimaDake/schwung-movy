/* The page's voices (plans/2026-11-07-gen-audition-design.md, Sound): one
 * fixed synthesised sound per role, so the ear judges the notes and not a
 * patch. The part under test plays a little louder. */
const KICK = [35, 36], SNARE = [38, 39, 40], HATS = [42, 44, 46];
const hz = (p) => 440 * 2 ** ((p - 69) / 12);

export function makeSynth() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const out = ctx.createDynamicsCompressor();
    out.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(out);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const env = (g, t, peak, a, len) => {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + a);
        g.gain.exponentialRampToValueAtTime(0.0001, t + a + len);
    };
    const osc = (type, f, t, stop, to) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.connect(to); o.start(t); o.stop(stop); return o; };
    const gain = (to) => { const g = ctx.createGain(); g.connect(to); return g; };
    const filter = (type, f, to, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(to); return b; };
    const hiss = (t, len, to) => { const s = ctx.createBufferSource(); s.buffer = noise; s.connect(to); s.start(t); s.stop(t + len + 0.05); };

    function drum(pitch, t, v, bus) {
        if (KICK.includes(pitch)) {
            const g = gain(bus); env(g, t, v, 0.002, 0.32);
            osc('sine', 150, t, t + 0.4, g).frequency.exponentialRampToValueAtTime(42, t + 0.12);
        } else if (SNARE.includes(pitch)) {
            const g = gain(bus); env(g, t, v * 0.7, 0.002, 0.18);
            hiss(t, 0.2, filter('bandpass', 1800, g, 0.8));
            const b = gain(bus); env(b, t, v * 0.35, 0.002, 0.08); osc('triangle', 190, t, t + 0.12, b);
        } else if (HATS.includes(pitch)) {
            const len = pitch === 46 ? 0.28 : 0.045;
            const g = gain(bus); env(g, t, v * 0.32, 0.001, len); hiss(t, len, filter('highpass', 7500, g));
        } else {
            const g = gain(bus); env(g, t, v * 0.4, 0.002, 0.1); osc('sine', 300 + (pitch % 24) * 25, t, t + 0.15, g);
        }
    }

    function tone(track, pitch, t, dur, v, bus) {
        const f = hz(pitch), end = t + dur;
        if (track === 'bass') {
            const g = gain(bus); env(g, t, v * 0.5, 0.004, Math.max(0.08, dur));
            const lp = filter('lowpass', 700, g, 2);
            lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.2);
            osc('sawtooth', f, t, end + 0.1, lp); osc('sine', f, t, end + 0.1, g);
        } else if (track === 'chords') {
            const g = gain(bus);
            /* Kept low and dark: a 3-4 note voicing of two saws each would bury the lead. */
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.045, t + 0.05);
            g.gain.setValueAtTime(v * 0.045, end); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.25);
            const lp = filter('lowpass', 1600, g);
            osc('sawtooth', f * 1.003, t, end + 0.3, lp); osc('sawtooth', f * 0.997, t, end + 0.3, lp);
        } else {
            /* The lead holds its level for the note's length, so long notes stay heard over the pad. */
            const g = gain(bus), rel = end + 0.12;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.26, t + 0.004);
            g.gain.exponentialRampToValueAtTime(v * 0.18, t + 0.08); g.gain.setValueAtTime(v * 0.18, end);
            g.gain.exponentialRampToValueAtTime(0.0001, rel);
            const lp = filter('lowpass', 2600, g);
            lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(2600, t + 0.15);
            osc('sawtooth', f, t, rel + 0.02, lp); osc('square', f * 1.002, t, rel + 0.02, lp);
        }
    }

    /* One fader per track (the page's mixer); the part under test enters
     * its track's fader a little louder. */
    const fader = {}, lift = {};
    for (const t of ['drums', 'bass', 'chords', 'lead']) {
        fader[t] = gain(master);
        lift[t] = gain(fader[t]);
        lift[t].gain.value = 1.4;
    }
    return {
        ctx,
        setLevel(track, v) { fader[track].gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
        /** One scheduled event (core.schedule) at audio time `at`. */
        play(ev, at, isTarget) {
            const bus = isTarget ? lift[ev.track] : fader[ev.track], v = Math.max(0.05, ev.vel / 127);
            if (ev.track === 'drums') drum(ev.pitch, at, v, bus);
            else tone(ev.track, ev.pitch, at, ev.dur, v, bus);
        },
    };
}
