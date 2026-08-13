/* A lone envelope stage — an Attack or a Decay knob that is NOT part of a
 * detected envelope group, so the envelope graphic never draws it. Plaits' and
 * po32-drum's bare "Decay", the 303's three decays, Signal's per-voice attack.
 *
 * Drawn as a single stage rather than an arc: a percentage says nothing about
 * whether a drum is a click or a long tail, where the ramp's length says it at
 * a glance.
 * Pure: indices only, no rendering. */

import type { KnobParam } from '../types/param.js';

export type EnvStage = 'a' | 'd';

const ATTACK = ['attack', 'atk', 'att'];
const DECAY  = ['decay', 'dcy', 'dec'];
/* Same vetoes envelope.ts applies: a curve/mode control is not a time, and an
 * LFO's own segments are a modulator shape rather than an amplitude stage. */
const VETO = new Set(['shape', 'curve', 'mode', 'slope']);
const isLfoToken = (w: string) => /^lfo[0-9]*$/.test(w);
/* A randomiser is an amount, not the thing it names (step-labels.ts) —
 * euclidrum has eight "Decay Rnd" knobs that randomise decay, not set it. */
const isRnd = (w: string) => /^(rnd|rand|random|randomi[sz]e)$/.test(w);
/* A reverb or delay "decay" is a tail LENGTH, not an amplitude-envelope stage.
 * Drawing an envelope for a room size would say the wrong thing. */
const isTail = (w: string) => /^(reverb|rev|verb|delay|echo|room|hall|plate)$/.test(w);

const words = (text: string): string[] =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

/* Which stage this param is, or null. Deliberately has NO bare-letter fallback,
 * unlike envelope.ts: minijv labels a multi-segment Roland TVA envelope
 * "A.Env L1"/"A.Env T3" (Amp Envelope), and reading that 'a' as the attack
 * STAGE turned 32 level/time params into attacks. A lone glyph is a strong
 * claim about a param, so it needs the word spelled out. */
export function envStageOf(p: KnobParam): EnvStage | null {
    if (p.type === 'enum' || p.type === 'file') return null;
    /* Vetoes are checked across key AND label together, not per-text. Chordism
     * keys its reverb tail `reverb_decay` but LABELS it plain "Decay": vetoing
     * only the text that happened to carry the word let the label through and
     * drew an amplitude envelope for a room size. */
    const all = [...words(p.key), ...words(p.label)];
    if (all.some((w) => VETO.has(w) || isLfoToken(w) || isRnd(w) || isTail(w))) return null;
    if (ATTACK.some((w) => all.includes(w))) return 'a';
    if (DECAY.some((w) => all.includes(w))) return 'd';
    return null;
}

/* Lone stages on a page. `claimed` holds the cells an envelope/LFO/filter
 * graphic already draws, so a stage inside a real envelope is skipped — that
 * group is the better picture and it is already on screen. */
export function envStageCells(
    params: (KnobParam | null)[], claimed: Set<number>,
): Map<number, EnvStage> {
    const out = new Map<number, EnvStage>();
    params.forEach((p, i) => {
        if (!p || claimed.has(i)) return;
        const st = envStageOf(p);
        if (st) out.set(i, st);
    });
    return out;
}
