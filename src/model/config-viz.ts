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
