/* The bench's scores (plans/2026-10-27-generators-quality-design.md §3). The
 * headline is alignment with the real example: recovery of the clean part for
 * a messy quantize, alignment with the real B for a variation. Fit and groove
 * explain a score; they are never the goal on their own. Key membership is
 * never scored: harmony is what the other tracks sound, not a scale. */
import { sceneChords } from '../../dist/esm/ai/index.js';
import { difference, STEP } from './sim.mjs';

export { difference };

const BAR = 16 * STEP;
const BEAT = 4 * STEP;
const pc = (p) => ((p % 12) + 12) % 12;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const jaccard = (A, B) => { const u = new Set([...A, ...B]); if (!u.size) return 1; let i = 0; for (const x of A) if (B.has(x)) i++; return i / u.size; };

/* The scene the option will play in: the other tracks' clips in the target's
 * scene, or the source scene when the target's is empty there. */
function otherClips(ctx) {
    const { set } = ctx;
    const others = set.tracks.filter((t) => t.index !== set.target.track);
    const at = (slot) => others.flatMap((t) => t.clips.filter((c) => c.slot === slot));
    const here = at(set.target.slot);
    return here.length || !set.source ? here : at(set.source.slot);
}

function chordsOf(ctx) {
    const drum = new Map(ctx.set.tracks.map((t) => [t.index, t.drum]));
    return sceneChords(otherClips(ctx), (i) => !!drum.get(i));
}

/* Chord tones 1; 9th, 11th (on minor chords) and 13th 0.8; a weak-position
 * note moving on by step is a passing/approach note 0.9; a strong-position
 * note a semitone or tritone from a chord tone is a clash 0. */
export function fit(opt, ctx) {
    if (ctx.drum || !opt.length) return null;
    const chords = chordsOf(ctx);
    const sorted = [...opt].sort((a, b) => a.tick - b.tick);
    let sum = 0, w = 0;
    sorted.forEach((n, i) => {
        const ch = chords.length ? chords[Math.floor(n.tick / BAR) % chords.length] : null;
        const weight = Math.min(n.gate, BEAT);
        let s;
        if (!ch || !ch.pcs.length) s = 1;
        else {
            const rel = (pc(n.pitch) - ch.root + 12) % 12;
            const minor = ch.pcs.some((x) => (x - ch.root + 12) % 12 === 3);
            const next = sorted.slice(i + 1).find((x) => x.tick > n.tick);
            const stepwise = next && Math.abs(next.pitch - n.pitch) <= 2 && next.tick - n.tick <= 2 * STEP;
            if (ch.pcs.includes(pc(n.pitch))) s = 1;
            else if (rel === 2 || rel === 9 || (minor && rel === 5)) s = 0.8;
            else if (n.tick % BEAT !== 0 && stepwise) s = 0.9;
            else if (n.tick % BEAT === 0 && ch.pcs.some((x) => [1, 6, 11].includes((pc(n.pitch) - x + 12) % 12))) s = 0;
            else s = n.tick % BEAT === 0 ? 0.3 : 0.6;
        }
        sum += s * weight;
        w += weight;
    });
    return w ? sum / w : null;
}

/* Where each 16th of a bar lands in this scene: the median onset of the other
 * tracks in that slot (so swing or push is the groove), else the straight
 * grid. An onset within 3 ticks of its slot's landing point is in the pocket. */
export function groove(opt, ctx) {
    if (!opt.length) return null;
    const onsets = otherClips(ctx).flatMap((c) => c.notes.map((n) => n.tick % BAR));
    const land = Array.from({ length: 16 }, (_, s) => {
        const near = onsets.filter((t) => Math.abs(t - s * STEP) <= STEP / 2);
        return near.length ? median(near) : s * STEP;
    });
    const inPocket = opt.filter((n) => {
        const t = n.tick % BAR;
        const s = Math.min(15, Math.round(t / STEP));
        return Math.abs(t - land[s]) <= 3 || (s + 1 < 16 && Math.abs(t - land[s + 1]) <= 3);
    }).length;
    return inPocket / opt.length;
}

/** F1 of option notes against the clean part: same pitch (class on melodic
 *  parts, exact on drums), onset within half a step. */
export function recovery(opt, ref, drum) {
    if (!ref || !ref.length) return null;
    const used = new Set();
    let hit = 0;
    for (const n of opt) {
        const k = ref.findIndex((r, i) => !used.has(i) && Math.abs(r.tick - n.tick) <= STEP / 2
            && (drum ? r.pitch === n.pitch : pc(r.pitch) === pc(n.pitch)));
        if (k >= 0) { used.add(k); hit++; }
    }
    const p = opt.length ? hit / opt.length : 0, r = hit / ref.length;
    return p + r ? (2 * p * r) / (p + r) : 0;
}

/* How alike two parts are, the way a listener hears a section: rhythm (onset
 * steps), harmony (pitch classes per bar), density and register. */
function likeness(x, y) {
    const steps = (a) => new Set(a.map((n) => Math.round(n.tick / STEP)));
    const bars = Math.max(1, ...[...x, ...y].map((n) => Math.floor(n.tick / BAR) + 1));
    let harm = 0;
    for (let b = 0; b < bars; b++) {
        const pcs = (a) => new Set(a.filter((n) => Math.floor(n.tick / BAR) === b).map((n) => pc(n.pitch)));
        harm += jaccard(pcs(x), pcs(y));
    }
    const dens = Math.min(x.length, y.length) / Math.max(1, x.length, y.length);
    const reg = Math.max(0, 1 - Math.abs(median(x.map((n) => n.pitch)) - median(y.map((n) => n.pitch))) / 12);
    return (jaccard(steps(x), steps(y)) + harm / bars + dens + reg) / 4;
}

/** 1 = sounds like the real B, 0 = like the A it came from (or like neither). */
export function bAlignment(opt, a, b) {
    const span = likeness(b, b) - likeness(b, a);
    if (span <= 0) return null;
    return Math.max(0, Math.min(1, (likeness(opt, b) - likeness(opt, a)) / span));
}

/** Rhythm and pitch kept from what the user played. */
export function ideaKept(opt, input) {
    const steps = (a) => new Set(a.map((n) => Math.round(n.tick / STEP)));
    return (jaccard(steps(opt), steps(input)) + (1 - difference(opt, input))) / 2;
}

const same = (a, b) => a.length === b.length && a.every((n, i) => n.tick === b[i].tick && n.pitch === b[i].pitch
    && n.gate === b[i].gate && n.vel === b[i].vel);

/* Usable as it stands: something in every stretch where the input had
 * something (half bars for a quantize, bars for a variation), a sane amount of
 * notes, a sane register, and not a copy of the input. */
export function usable(opt, ctx) {
    const reasons = [];
    const base = ctx.task === 'variation' ? (ctx.a ?? ctx.input) : ctx.input;
    const span = ctx.task === 'variation' ? BAR : BAR / 2;
    if (!opt.length) reasons.push('empty');
    if (same([...opt].sort((x, y) => x.tick - y.tick || x.pitch - y.pitch), [...ctx.input].sort((x, y) => x.tick - y.tick || x.pitch - y.pitch))) reasons.push('copy');
    const parts = Math.ceil((ctx.len * STEP) / span);
    for (let i = 0; i < parts; i++) {
        const has = (a) => a.some((n) => n.tick >= i * span && n.tick < (i + 1) * span);
        if (has(base) && !has(opt)) { reasons.push(`gap@${i}`); break; }
    }
    if (base.length && (opt.length < 0.4 * base.length || opt.length > 2.5 * base.length)) reasons.push('density');
    if (!ctx.drum && base.length && opt.length
        && Math.abs(median(opt.map((n) => n.pitch)) - median(base.map((n) => n.pitch))) > 12) reasons.push('register');
    return reasons;
}

export function scoreOption(opt, ctx) {
    const reasons = usable(opt, ctx);
    return {
        fit: fit(opt, ctx),
        groove: groove(opt, ctx),
        recovery: ctx.task === 'quantize' ? recovery(opt, ctx.reference, ctx.drum) : null,
        bAlign: ctx.task === 'variation' && ctx.reference && ctx.a ? bAlignment(opt, ctx.a, ctx.reference) : null,
        ideaKept: ideaKept(opt, ctx.input),
        usable: reasons.length === 0,
        reasons,
    };
}

export const MIN_PAIR_DIFF = 0.2;

/* Three options must all survive; of Variation's eight, the validator may drop
 * a role break or a same loop and still leave the user a real choice. */
export const minKept = (expected) => (expected <= 3 ? expected : expected - 2);

export function scoreReply(options, ctx) {
    const perOption = options.map((o) => scoreOption(o, ctx));
    let minPairDiff = 1;
    for (let i = 0; i < options.length; i++) {
        for (let j = i + 1; j < options.length; j++) minPairDiff = Math.min(minPairDiff, difference(options[i], options[j]));
    }
    const head = perOption.map((s) => s.recovery ?? s.bAlign).filter((v) => v !== null && v !== undefined);
    const ladder = ctx.task === 'variation'
        ? options.map((o) => difference(o, ctx.a ?? ctx.input)) : perOption.map((s) => -s.ideaKept);
    return {
        perOption,
        alignment: head.length ? Math.max(...head) : null,
        gatePassed: options.length >= minKept(ctx.expected ?? 3) && perOption.every((s) => s.usable) && minPairDiff >= MIN_PAIR_DIFF,
        kept: options.length / (ctx.expected ?? 3),
        minPairDiff: options.length > 1 ? minPairDiff : 0,
        ladderOrdered: ladder.every((v, i) => i === 0 || v >= ladder[i - 1] - 0.05),
    };
}
