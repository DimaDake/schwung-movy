/* config-viz.ts — a movy_config slot's graphic tag, as Schwung's `viz`.
 *
 * movy's config tags a slot as part of an envelope, filter or LFO, or as a bar.
 * Schwung's contract has the same idea (docs/MODULES.md "Parameter
 * visualisations"), declared per param. Declaring it on the translated inline
 * entry (config-hierarchy.ts) is the contract's own route, not a workaround:
 * Schwung's metaIndex lets a module's real `chain_params` entry win, so a
 * module that declares its own `viz` is never overruled. An untagged slot is
 * left to Schwung's detector.
 *
 * Only roles Schwung has are mapped. movy's lfo `mode`/`retrig`/`deform` have
 * no Schwung role and stay undeclared rather than becoming a group that
 * cannot draw.
 */
import type { KnobSlot } from '../types/param.js';

const ENV_ROLE: Record<string, string> = { a: 'attack', d: 'decay', s: 'sustain', r: 'release' };
const LFO_ROLES = new Set(['shape', 'rate', 'depth', 'phase']);

/**
 * The `viz` for a slot, or undefined for none. `group` scopes a graphic to one
 * config row: movy draws one graphic per line, and Schwung cannot draw across
 * the row gap anyway.
 */
export function vizOf(slot: KnobSlot, group: string): unknown {
    if (slot.env === false) return false;
    if (slot.env && ENV_ROLE[slot.env]) return { group: group + ':env', role: ENV_ROLE[slot.env], kind: 'envelope' };
    if (slot.filter) return { group: group + ':filter', role: slot.filter, kind: 'filter' };
    if (slot.lfo && LFO_ROLES.has(slot.lfo)) return { group: group + ':lfo', role: slot.lfo, kind: 'lfo' };
    if (slot.render === 'vbar' || slot.render === 'hbar') return { kind: 'fader' };
    return undefined;
}

const ROW_WIDTH = 4;

/**
 * Make a split group drawable: roles outside the run that starts at the
 * group's first slot become `span: false`.
 *
 * Schwung draws a graphic only over adjacent cells in one row. forge's Mod row
 * is Shape, Rate, Sync, Depth: Sync is no LFO role and breaks the run, so the
 * whole group was refused and nothing drew. `span: false` is the contract's own
 * answer (docs/MODULES.md, DR32's envelope `mode`): the role lends the picture
 * its value and keeps its own cell. So the wave covers Shape+Rate and Depth
 * still scales it from its own knob.
 *
 * `params` is in knob order, so an index is the planned slot. Mutates them.
 */
export function settleSpans(params: Record<string, any>[]): void {
    const groups = new Map<string, number[]>();
    params.forEach((p, i) => {
        const g = p && p.viz && p.viz.group;
        if (g) (groups.get(g) || groups.set(g, []).get(g)!).push(i);
    });
    for (const slots of groups.values()) {
        const first = slots[0];
        let end = first;
        while (slots.includes(end + 1) && Math.floor((end + 1) / ROW_WIDTH) === Math.floor(first / ROW_WIDTH)) end++;
        for (const s of slots) if (s > end) params[s].viz = { ...params[s].viz, span: false };
    }
}
