/* `access` — which direction a param means something in.
 *
 * Optional on a chain_params entry, defaulting to `readwrite`. A module
 * declares it when its parameter is not both:
 *
 *   read    a READOUT. The value means something, writing means nothing.
 *           Never turnable, never opens a picker, still refreshed on screen,
 *           and drawn inside a dotted frame.
 *   write   a TRIGGER. Writing does something, the value means nothing.
 *           Never turnable; a turn FIRES it.
 *
 * Both halves fix something movy gets wrong by guessing.
 *
 * `read` is the smaller one: keydetect's `detected_key` is 25 key names with no
 * `set_param` branch at all, so movy drew a turnable knob over a value it could
 * never change and the picker silently discarded whatever was chosen.
 *
 * `write` is the hazard. movy infers a trigger from the KEY NAME, and only on a
 * param already shaped like a boolean (toggle.ts) — so euclidrum's `rnd_preset`,
 * an enum of `["—","Rnd!"]`, reads to movy as an ordinary two-option setting.
 * It is not: the module fires on anything that is not the em-dash, which makes
 * an index write of "0" — meaning "do nothing" — randomise all eight lanes and
 * destroy the kit. Reading the declaration routes it through movy's trigger
 * gesture instead, where the idle option is only ever written deliberately.
 *
 * Declaration-wins / heuristic-as-fallback, the pattern schwung's voices
 * contract (#411) established: a module that says nothing keeps movy's guess. */

import type { KnobParam } from '../types/param.js';

export type Access = 'read' | 'write';

/* First declaration that says anything wins, in the caller's precedence order
 * (chain_params before ui_hierarchy, as everywhere else). An explicit
 * `readwrite` is a statement too — it stops a lower-precedence source from
 * making the param a readout — so it terminates the search rather than
 * falling through. */
export function readAccess(...declared: unknown[]): Access | null {
    for (const v of declared) {
        if (typeof v !== 'string') continue;
        const s = v.trim().toLowerCase();
        if (s === 'read' || s === 'write') return s;
        if (s === 'readwrite') return null;
    }
    return null;
}

/* Whether a long list may open the picker. Readouts have nothing to set and
 * triggers have nothing to choose — schwung says neither is divable, and movy
 * would otherwise dive both: a readout through the >6-option touch rule, a
 * trigger through the long press, which accepts ANY enum. */
export function isDivable(p: KnobParam): boolean {
    return !p.readOnly && p.behavior !== 'trigger';
}
