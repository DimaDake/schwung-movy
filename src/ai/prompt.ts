/* What the model is asked (design §2, §3, §6.3). Three Smart Quantize or
 * eight Variation options on the ladder of the GENERATORS level (ladders.ts,
 * plans/2026-10-27-variation-eight-options.md), always grown from
 * the user's own notes; the reply is JSON in the clip's own step grid so
 * validate.ts can check every value. */

import { TICKS_PER_STEP } from './clip-dump.js';
import { type GenLevel, ladder, optionCount } from './ladders.js';
import { type Role, roleText } from './role.js';

/* double and create never reach a model: they are algorithmic only (job.ts). */
export type AiTask = 'quantize' | 'variation' | 'double' | 'create';

/* Which prompt the generators send. Each switch was A/B'd on the bench
 * (plans/gen-bench-results-*.md); the default is what won. */
export interface PromptStyle { units: 'steps' | 'ticks'; harmonyRules: boolean; partRules: boolean }
export const DEFAULT_STYLE: PromptStyle = { units: 'steps', harmonyRules: true, partRules: true };

/* facts: what a Variation knows beyond the context (facts.ts); absent, the
 * target scene counts as free and no role is stated. */
export interface PromptTarget {
    len: number;   // steps
    drum: boolean;
    level?: GenLevel;
    style?: Partial<PromptStyle>;
    facts?: { role: Role | null; harmonySet: boolean };
}

const SYSTEM = 'You are a music co-producer inside a hardware groovebox. You never write from nothing: '
    + 'every option you return grows out of the MIDI the user played, and must still sound like their idea. '
    + 'Answer with one JSON object only, no prose.';

const DRUM_PAD_RULE = 'In options 2 and 3 a hit may move to another pad only where it clearly helps '
    + '(an obvious mis-hit, or a deliberate groove move), and only to a pad this kit already uses.';
/* Each track's Variation is asked alone, so a demand to reharmonise once the
 * scene already has chords made every track pick its own (device Set
 * 2026-10-27): only an empty scene may move, and then not to A's chords
 * reordered, which is the same loop again. */
const VAR_NEW_CHORDS = 'The [TARGET] scene has no chords from other tracks yet: options 1, 3, 5 and 7 move to new '
    + 'chords that let the song move on (say which in the label), never the [SOURCE] scene\'s chords in another order; '
    + 'the others keep the [SOURCE] scene\'s chords.';
const VAR_FOLLOW = 'The [TARGET] scene\'s chords are set by the other tracks (HARMONY, [TARGET]): every option follows '
    + 'them bar by bar and none reharmonises; colour comes from tensions and passing notes.';
const SAME_LOOP_RULE = 'SAME-LOOP RULE: no option may be a clip of this track moved in time (bars swapped, reordered or '
    + 'rotated) or transposed as a whole. Change the notes themselves.';
const HARMONY_RULES = 'HARMONY RULES: fit the chords listed in HARMONY for each bar of the target scene, which are the chords '
    + 'the other tracks sound. Chord tones and 9th/11th/13th tensions always fit; other notes belong on weak positions, '
    + 'moving by step. Borrowed chords and notes outside the Set\'s key are welcome where the other tracks allow them: '
    + 'the key is a hint, not a rule.';
const PART_RULES = 'PART RULES: every option is a complete part. It plays across the whole clip wherever the original '
    + 'plays (no empty half-bars), with between half and double the original\'s number of notes, in a similar register. '
    + 'At least a third of each option\'s notes differ (in step or pitch) from every other option, and none repeats the original.';

function taskText(task: AiTask, t: PromptTarget): string[] {
    const steps = ladder(task, t.drum, t.level ?? 'BALANCED');
    if (task === 'quantize') {
        return ['TASK: smart quantize the [TARGET] clip. Keep the recorded idea; align it with the song.',
            ...steps, ...(t.drum ? [DRUM_PAD_RULE] : [])];
    }
    return ['TASK: write a variation for the [TARGET] clip that continues from the [SOURCE] clip (an A part '
        + 'becoming a B part). Fit what the other tracks play in the target scene; if they are empty there, '
        + 'use the source clip\'s scene as the reference so the variation moves on from it. '
        + 'Fit the chords of the [TARGET] scene in HARMONY; where they differ from the [SOURCE] scene\'s, follow them. '
        + 'Keep the source\'s sound, style and feel.',
    ...(t.facts?.role ? [roleText(t.facts.role, t.len)] : []),
    ...steps, SAME_LOOP_RULE,
    ...(t.drum ? ['Use only pads this kit already uses.'] : [t.facts?.harmonySet ? VAR_FOLLOW : VAR_NEW_CHORDS])];
}

function unitRules(len: number, units: PromptStyle['units'], n: number): string[] {
    if (units === 'ticks') {
        return [`RULES: the clip is ${len} steps long. Ticks run 0 to ${len * TICKS_PER_STEP - 1} in the clip's own time `
            + '(its playback speed is applied by the device, do not rescale). gate >= 1 tick, velocity 1-127, '
            + 'pitch is the stored MIDI number exactly as listed (transpose is applied by the device).',
        'REPLY: {"options":[{"label":"<= 12 chars","notes":[[tick,gate,pitch,velocity],...],'
            + `"moved":["one line per pad or chord change"]}, ... exactly ${n} options]}`];
    }
    return [`RULES: the clip is ${len} steps long (16 steps per bar). A note is [step, length, pitch, velocity]: step runs `
        + `0 to under ${len} in the clip's own time, numbered exactly like the @positions in the context; fractions such as `
        + '12.25 are fine for feel. length is in steps (at least 0.05), velocity 1-127, pitch is the stored MIDI number '
        + 'exactly as listed (playback speed and transpose are applied by the device, do not rescale).',
    'REPLY: {"options":[{"label":"<= 12 chars","notes":[[step,length,pitch,velocity],...],'
        + `"moved":["one line per pad or chord change"]}, ... exactly ${n} options]}`];
}

export function buildPrompt(task: AiTask, context: string, t: PromptTarget): { system: string; user: string; units: PromptStyle['units'] } {
    const style = { ...DEFAULT_STYLE, ...t.style };
    const n = optionCount(task);
    const user = [context, '', ...taskText(task, t), '',
        `The ${n} options must sound clearly different from each other.`,
        ...(style.harmonyRules && !t.drum ? [HARMONY_RULES] : []),
        ...(style.partRules ? [PART_RULES] : []),
        ...unitRules(t.len, style.units, n),
    ].join('\n');
    return { system: SYSTEM, user, units: style.units };
}
