/* The note roll: one lane per track, the part under test lit, bar lines in
 * 4/4, fault marks where the user tapped. Drawn once per case or option to
 * an offscreen canvas; only the playhead redraws per frame. */
import { TRACKS } from './core.mjs';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const ROWS = { drums: 1.1, bass: 1, chords: 1.3, lead: 1.3 };
const PADS = [[35, 36], [38, 39, 40], [42, 44, 46]];

export function makeRoll(canvas) {
    const base = document.createElement('canvas');
    let view = null;

    function lanes(h) {
        const total = TRACKS.reduce((n, t) => n + ROWS[t], 0);
        let y = 0;
        return TRACKS.map((t) => { const lh = (ROWS[t] / total) * h; const l = { t, y, h: lh }; y += lh; return l; });
    }

    function draw({ tracks, len, target, marks, muted }) {
        const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
        for (const c of [canvas, base]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const g = base.getContext('2d');
        g.scale(dpr, dpr);
        g.clearRect(0, 0, w, h);
        const x = (b) => (b / len) * w;
        for (const l of lanes(h)) {
            if (l.t === target) { g.fillStyle = css('--lane-hi'); g.fillRect(0, l.y, w, l.h); }
            g.fillStyle = css('--ink-faint');
            g.font = `600 9px ${css('--font-data')}`;
            g.fillText(l.t.toUpperCase(), 4, l.y + 11);
            const ns = tracks[l.t] ?? [];
            const color = muted.has(l.t) ? css('--ink-faint') : css(`--${l.t}`);
            g.fillStyle = color;
            if (l.t === 'drums') {
                for (const [s, , p] of ns) {
                    const row = PADS.findIndex((r) => r.includes(p)), r = row < 0 ? 3 : row;
                    const cy = l.y + l.h - ((r + 0.5) / 4) * (l.h - 14) - 2;
                    g.fillRect(x(s / 96) - 1, cy - 2, 3, 4);
                }
            } else if (ns.length) {
                const ps = ns.map((n) => n[2]), lo = Math.min(...ps) - 1, hi = Math.max(...ps) + 1;
                const nh = Math.max(2, Math.min(5, (l.h - 16) / (hi - lo + 1)));
                for (const [s, d, p] of ns) {
                    const cy = l.y + 14 + ((hi - p) / (hi - lo)) * (l.h - 18 - nh);
                    g.fillRect(x(s / 96), cy, Math.max(2, x(d / 96) - 1), nh);
                }
            }
            g.fillStyle = css('--rule'); g.fillRect(0, l.y + l.h - 0.5, w, 0.5);
        }
        for (let b = 0; b <= len; b++) {
            g.fillStyle = b % 4 ? css('--rule') : css('--ink-faint');
            g.fillRect(Math.min(w - 1, x(b)), 0, b % 4 ? 0.5 : 1, h);
        }
        for (const m of marks) {
            const b = (m.bar - 1) * 4 + (m.beat - 1);
            g.fillStyle = css('--mark'); g.globalAlpha = 0.28; g.fillRect(x(b), 0, x(1), h);
            g.globalAlpha = 1; g.fillRect(x(b), 0, x(1), 3);
        }
        view = { len, w, h, dpr };
        frame(null);
    }

    /** Copy the static roll and draw the playhead at `beat` (null: none). */
    function frame(beat) {
        if (!view) return;
        const g = canvas.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(base, 0, 0);
        if (beat === null) return;
        g.scale(view.dpr, view.dpr);
        g.fillStyle = css('--ink');
        g.fillRect(((beat % view.len) / view.len) * view.w, 0, 1.5, view.h);
    }

    return { draw, frame };
}
