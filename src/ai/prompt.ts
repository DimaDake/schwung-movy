/* What the model is asked (design §2, §3, §6.3). Three options on the
 * creativity ladder of the GENERATORS level (ladders.ts), always grown from
 * the user's own notes; the reply is JSON in the clip's own step grid so
 * validate.ts can check every value. */

import { TICKS_PER_STEP } from './clip-dump.js';
import { type GenLevel, ladder } from './ladders.js';

export type AiTask = 'quantize' | 'variation';

/* Which prompt the generators send. Each switch was A/B'd on the bench
 * (plans/gen-bench-results-*.md); the default is what won. */
export interface PromptStyle { units: 'steps' | 'ticks'; harmonyRules: boolean; partRules: boolean }
export const DEFAULT_STYLE: PromptStyle = { units: 'steps', harmonyRules: true, partRules: true };

export interface PromptTarget { len: number; drum: boolean; level?: GenLevel; style?: Partial<PromptStyle> }   // len in steps

const SYSTEM = 'You are a music co-producer inside a hardware groovebox. You never write from nothing: '
    + 'every option you return grows out of the MIDI the user played, and must still sound like their idea. '
    + 'Answer with one JSON object only, no prose.';

const DRUM_PAD_RULE = 'In options 2 and 3 a hit may move to another pad only where it clearly helps '
    + '(an obvious mis-hit, or a deliberate groove move), and only to a pad this kit already uses.';
const VAR_HARMONY = 'At least one option must move the harmony to different chords '
    + '(say which in its label), as long as the other tracks in the reference scene allow it.';
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
        + 'Keep the source\'s sound, style and feel.',
    ...steps, ...(t.drum ? ['Use only pads this kit already uses.'] : [VAR_HARMONY])];
}

function unitRules(len: number, units: PromptStyle['units']): string[] {
    if (units === 'ticks') {
        return [`RULES: the clip is ${len} steps long. Ticks run 0 to ${len * TICKS_PER_STEP - 1} in the clip's own time `
            + '(its playback speed is applied by the device, do not rescale). gate >= 1 tick, velocity 1-127, '
            + 'pitch is the stored MIDI number exactly as listed (transpose is applied by the device).',
        'REPLY: {"options":[{"label":"<= 12 chars","notes":[[tick,gate,pitch,velocity],...],'
            + '"moved":["one line per pad or chord change"]}, ... exactly 3 options]}'];
    }
    return [`RULES: the clip is ${len} steps long (16 steps per bar). A note is [step, length, pitch, velocity]: step runs `
        + `0 to under ${len} in the clip's own time, numbered exactly like the @positions in the context; fractions such as `
        + '12.25 are fine for feel. length is in steps (at least 0.05), velocity 1-127, pitch is the stored MIDI number '
        + 'exactly as listed (playback speed and transpose are applied by the device, do not rescale).',
    'REPLY: {"options":[{"label":"<= 12 chars","notes":[[step,length,pitch,velocity],...],'
        + '"moved":["one line per pad or chord change"]}, ... exactly 3 options]}'];
}

export function buildPrompt(task: AiTask, context: string, t: PromptTarget): { system: string; user: string; units: PromptStyle['units'] } {
    const style = { ...DEFAULT_STYLE, ...t.style };
    const user = [context, '', ...taskText(task, t), '',
        'The three options must sound clearly different from each other.',
        ...(style.harmonyRules && !t.drum ? [HARMONY_RULES] : []),
        ...(style.partRules ? [PART_RULES] : []),
        ...unitRules(t.len, style.units),
    ].join('\n');
    return { system: SYSTEM, user, units: style.units };
}
