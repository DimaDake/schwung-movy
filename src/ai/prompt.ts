/* What the model is asked (design §2, §3, §6.3). Three options on a fixed
 * creativity ladder, always grown from the user's own notes; the reply is
 * JSON in the clip's own tick grid so validate.ts can check every value. */

import { TICKS_PER_STEP } from './clip-dump.js';

export type AiTask = 'quantize' | 'variation';

export interface PromptTarget { len: number; drum: boolean }   // len in steps

const SYSTEM = 'You are a music co-producer inside a hardware groovebox. You never write from nothing: '
    + 'every option you return grows out of the MIDI the user played, and must still sound like their idea. '
    + 'Answer with one JSON object only, no prose.';

const QUANT_MELODIC = [
    'Option 1 (closest): fix only sloppy timing, locked to the groove of the other tracks in the target scene '
        + '(keep deliberate swing or push), and move wrong or clashing notes to the nearest note that fits the key and the chords around it.',
    'Option 2 (shaped): develop the idea: re-voice or fill out chords, use inversions, tighten the rhythm against drums and bass, '
        + 'remove accidental ghost notes and double hits.',
    'Option 3 (inspired): use the idea as a seed: reharmonise within the key, borrow rhythmic ideas from other tracks, '
        + 'answer or extend the phrase. It must still be recognisably the same idea.',
];
const QUANT_DRUM = [
    'Option 1 (closest): fix timing and velocity only, and keep every hit on the same pad (same pitch).',
    'Option 2 (shaped): tighten the groove to the other tracks, add or remove ghost notes, shape velocity accents.',
    'Option 3 (inspired): a bolder take on the groove: accents, ghost notes, feel.',
];
const DRUM_PAD_RULE = 'In options 2 and 3 a hit may move to another pad only where it clearly helps '
    + '(an obvious mis-hit, or a deliberate groove move), and only to a pad this kit already uses.';
const VAR_MELODIC = [
    'Option 1: the closest B part: same style, register and rhythmic feel, with a clear change that lets the song move on.',
    'Option 2: change the rhythm, density or register more boldly.',
    'Option 3: the most inventive B part.',
];
const VAR_HARMONY = 'At least one option must move the harmony to different chords within the same key '
    + '(say which in its label), as long as the other tracks in the reference scene allow it.';
const VAR_DRUM = [
    'Option 1: the same kit and feel with a clear pattern change (a fill, kick placement, hats opening up).',
    'Option 2: a bolder pattern change, for example a half-time or double-time feel.',
    'Option 3: the most inventive pattern that still keeps the kit and the style.',
];

function taskText(task: AiTask, t: PromptTarget): string[] {
    if (task === 'quantize') {
        return ['TASK: smart quantize the [TARGET] clip. Keep the recorded idea; align it with the song.',
            ...(t.drum ? [...QUANT_DRUM, DRUM_PAD_RULE] : QUANT_MELODIC)];
    }
    return ['TASK: write a variation for the [TARGET] clip that continues from the [SOURCE] clip (an A part '
        + 'becoming a B part). Fit what the other tracks play in the target scene; if they are empty there, '
        + 'use the source clip\'s scene as the reference so the variation moves on from it. '
        + 'Keep the source\'s sound, style and feel.',
    ...(t.drum ? [...VAR_DRUM, 'Use only pads this kit already uses.'] : [...VAR_MELODIC, VAR_HARMONY])];
}

export function buildPrompt(task: AiTask, context: string, t: PromptTarget): { system: string; user: string } {
    const maxTick = t.len * TICKS_PER_STEP - 1;
    const user = [context, '', ...taskText(task, t), '',
        'The three options must sound clearly different from each other.',
        `RULES: the clip is ${t.len} steps long. Ticks run 0 to ${maxTick} in the clip's own time `
            + '(its playback speed is applied by the device, do not rescale). gate >= 1 tick, velocity 1-127, '
            + 'pitch is the stored MIDI number exactly as listed (transpose is applied by the device).',
        'REPLY: {"options":[{"label":"<= 12 chars","notes":[[tick,gate,pitch,velocity],...],'
            + '"moved":["one line per pad or chord change"]}, ... exactly 3 options]}',
    ].join('\n');
    return { system: SYSTEM, user };
}
