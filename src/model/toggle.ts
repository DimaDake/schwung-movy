/* Which knobs are ON/OFF switches, and which only look like one.
 *
 * A boolean has no position within a range, so an arc is the wrong picture and
 * a two-item list is a needlessly heavy one: the module already told us the
 * whole vocabulary is "absent" and "present". Both spellings converge here —
 * an `int 0..1` and an enum whose two options read off→on are the same control
 * wearing different metadata.
 *
 * The pair must be ORDERED off-first. A reversed list drawn as a switch would
 * show the knob left while the module reports "on", which is worse than the
 * enum square it replaced. (No reversed pair exists in the current fleet; the
 * check is here so one arriving later is ignored rather than mis-drawn.) */

import type { KnobParam } from '../types/param.js';

const OFF_WORDS = ['off', 'no', 'disabled', 'disable', 'none',
                   'bypass', 'bypassed', 'out', 'false', '0'];
const ON_WORDS  = ['on', 'yes', 'enabled', 'enable', 'active', 'in', 'true', '1'];

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/* An ACTION spelled as a boolean: turning it "on" runs something once and the
 * module drops it back. A switch would sit stuck on forever after one use, so
 * these go to the trigger badge instead.
 *
 * Verbs are matched as a PREFIX (or the whole key), never anywhere in the name.
 * The loose version swept up half the fleet's modes: `lfo_trigger` and
 * `trigger_mode` are retrigger settings, `vca_hard_reset` is an envelope
 * behaviour, and `random_retrig` belongs to the *random* LFO shape rather than
 * being a randomiser. All four are toggles that happen to contain a verb.
 * `random` is absent for that last reason — every real randomiser here spells
 * itself `rnd_`. */
const ACTION_PREFIX = /^(rnd|rdm|init|reset|save|load|recall)_/;
const ACTION_EXACT  = ['trigger', 'mutate'];
const ACTION_SUFFIX = /_init$/;                  // forge's per-voice cv_init

export function isActionParam(p: KnobParam): boolean {
    if (!isToggleShaped(p)) return false;
    const k = p.key.toLowerCase();
    return ACTION_PREFIX.test(k) || ACTION_SUFFIX.test(k) || ACTION_EXACT.indexOf(k) >= 0;
}

/* Both spellings of a boolean: an int 0..1, or a 2-item list reading off→on.
 * Confining the action rule to this shape keeps it from reclassifying enum
 * squares it was never meant to touch — magneto's `Save`/`Saved` is an action
 * too, but it is not a control this change is converting. */
function isToggleShaped(p: KnobParam): boolean {
    /* An int 0..1 has no option names to read; two states IS the statement. */
    if (p.type === 'int') return p.min === 0 && p.max === 1;
    if (p.type !== 'enum' || (p.options?.length ?? 0) !== 2) return false;
    const [a, b] = (p.options as string[]).map(norm);
    return OFF_WORDS.indexOf(a) >= 0 && ON_WORDS.indexOf(b) >= 0;
}

export function isToggleParam(p: KnobParam): boolean {
    return isToggleShaped(p) && !isActionParam(p);
}

/* Which end the knob sits at. Enums carry the state as an index; an int carries
 * it as the value itself. */
export function toggleIsOn(type: string, enumIndex: number, normalized: number): boolean {
    return type === 'enum' ? enumIndex >= 1 : normalized >= 0.5;
}
