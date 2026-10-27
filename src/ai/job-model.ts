/* The job's model path, the parts with no state of their own: the prompt
 * for a request, and a reply read back into options (design §4, §6.3). */

import { mlog } from '../log.js';
import { buildContext, type AiTrackInput } from './context.js';
import { variationFacts } from './facts.js';
import type { Running } from './job-types.js';
import { buildPrompt } from './prompt.js';
import { extractText } from './provider.js';
import { setHeader } from './set-input.js';
import { type Validated, validateReply } from './validate.js';

/** The prompt, with what the validator later needs noted on the run. */
export function modelPrompt(r: Running, t: AiTrackInput, source: number | null): { system: string; user: string } {
    const c = r.ctx!;
    const input = { ...setHeader(), tracks: r.tracks, target: { track: r.track, slot: r.slot },
        source: source === null ? null : { track: r.track, slot: source } };
    const facts = r.task === 'variation' ? variationFacts(input, c.len) : undefined;
    if (facts) { c.source = facts.source; c.loops = facts.loops; }
    const prompt = buildPrompt(r.task, buildContext(input), { len: c.len, drum: t.drum, level: r.level, facts });
    c.units = prompt.units;
    return prompt;
}

/** The options a 200 reply holds, or the text to log when none survived. */
export function replyOptions(r: Running, body: string): { v: Validated | null; text: string } {
    const text = extractText(body);
    const c = r.ctx!;
    const v = text === null ? null : validateReply(text, { task: r.task, len: c.len, drum: c.drum,
        original: c.orig?.notes ?? [], kitPads: c.kit, units: c.units, source: c.source, loops: c.loops });
    if (v?.dropped.length) mlog('ai: dropped ' + v.dropped.join(' '));
    return { v, text: (text ?? body).slice(0, 200) };
}
