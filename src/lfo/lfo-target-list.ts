/* lfo-target-list.ts — an LFO's Target as a KNOB on Schwung's LFO page.
 *
 * A routing is two stored keys (`target` names a component, `target_param` one
 * of its params) and what is loaded decides which pairs exist, so Schwung's
 * contract takes them as one flat enum its host supplies (`lfoTargetOptions`).
 * This is movy's host half: the routings movy can reach — `scope.components`
 * plus the other LFO, the same reach limit hold-to-modulate has — and the
 * index <-> pair translation at the io boundary. The commit is movy's own
 * (`assignLfoTarget`), so `enabled` and the fresh-LFO depth travel with it and
 * undo records it as one gesture.
 *
 * Inert (`knob: false`) on a Schwung without `lfoTargetOptions`, whose
 * lfoParams ignores `targets`: Target is then a door and the source's picker
 * sets it.
 */

import type { LfoTargetList, SchwungLfoPage } from '../renderer/schwung-lib.js';
import type { LfoScope } from './scope.js';
import { componentKey } from './scope.js';
import { assignLfoTarget, clearLfoTarget } from './assign.js';
import { compLabel } from './params.js';

type Route = { target: string; param: string };
type Entry = { key: string; label: string };

/* What one LFO may drive on another — Schwung's LFO_TARGET_PARAMS, same
 * labels, so the knob reads the same on both hosts. */
const LFO_TARGET_PARAMS: Entry[] = [
    { key: 'depth', label: 'Depth' },
    { key: 'rate_hz', label: 'Rate Hz' },
    { key: 'phase_offset', label: 'Phase Offset' },
];
/* Schwung's modulatable filter (`flatLfoTargetParams`). */
const MODULATABLE = new Set(['float', 'int', 'enum']);

export interface LfoTargetLists {
    readonly knob: boolean;
    /** chain_params with Target declared as the enum — same bytes while the
     *  lists stand, so the contract poll sees no change and never re-plans. */
    chainParams(): string;
    /** The stored routing's option index, as the grid reads an enum. */
    read(bank: number): string;
    commit(bank: number, value: string): void;
    /** The option UNDER THE KNOB — mid-turn that is not yet the stored
     *  routing, so it comes from `raw`, never a read. */
    format(bank: number, raw: string | null, surface: 'cell' | 'header'): string | null;
}

export function lfoTargetLists(scope: LfoScope, lp: SchwungLfoPage, params: any[]): LfoTargetLists {
    const knob = typeof lp.lfoTargetOptions === 'function' && typeof lp.lfoTargetIndex === 'function';
    const read = (k: string): string | null => scope.port.getParam(k);
    const key = (bank: number, name: string): string => scope.keyPrefix + 'lfo' + (bank + 1) + ':' + name;
    const stored = (bank: number): Route =>
        ({ target: read(key(bank, 'target')) || '', param: read(key(bank, 'target_param')) || '' });

    /*
     * Built once and KEPT: a chain_params read per component, and the
     * controller asks for chain_params on every contract poll. The source this
     * serves lives exactly as long as the modules do (`schwungGridReload`
     * drops it on a module change). The one staleness left is a routing made
     * elsewhere that the list lacks — `current` catches it and rebuilds, since
     * reading None over a live routing would let the next detent replace it.
     */
    const lists: (LfoTargetList | null)[] = [null, null];
    function build(bank: number, current: Route | null): LfoTargetList {
        const cps = new Map<string, Entry[]>();
        const components: Entry[] = [];
        for (const comp of scope.components) {
            const ck = componentKey(scope, comp);
            let arr: any[] = [];
            try { arr = JSON.parse(read(ck + ':chain_params') || '[]'); } catch { arr = []; }
            if (!Array.isArray(arr) || !arr.length) continue;      /* nothing loaded there */
            const seen = new Set<string>();
            const flat: Entry[] = [];
            for (const p of arr) {
                if (!p || !p.key || seen.has(p.key) || !MODULATABLE.has(p.type)) continue;
                seen.add(p.key);
                flat.push({ key: p.key, label: String(p.name || p.label || p.key) });
            }
            cps.set(comp, flat);
            components.push({ key: comp, label: compLabel(comp) + ': ' + (read(ck + ':name') || comp) });
        }
        const other = bank === 0 ? 2 : 1;
        cps.set('lfo' + other, LFO_TARGET_PARAMS);
        components.push({ key: 'lfo' + other, label: 'LFO ' + other });
        return lp.lfoTargetOptions!({ components, paramsFor: (k) => cps.get(k) || [],
                                      current: current || stored(bank) });
    }
    function listFor(bank: number, current: Route | null): LfoTargetList {
        const have = lists[bank];
        if (have && (!current || lp.lfoTargetIndex!(have.routes, current.target, current.param) >= 0)) {
            return have;
        }
        return (lists[bank] = build(bank, current));
    }

    let json = '';
    let jsonFor: (LfoTargetList | null)[] = [];
    return {
        knob,
        chainParams(): string {
            if (!knob) return JSON.stringify(params);
            const a = listFor(0, null), b = listFor(1, null);
            if (json && jsonFor[0] === a && jsonFor[1] === b) return json;
            jsonFor = [a, b];
            json = JSON.stringify(lp.lfoParams(1, scope.keyPrefix, { targets: a })
                .concat(lp.lfoParams(2, scope.keyPrefix, { targets: b })));
            return json;
        },
        read(bank: number): string {
            const cur = stored(bank);
            return String(Math.max(0, lp.lfoTargetIndex!(listFor(bank, cur).routes, cur.target, cur.param)));
        },
        commit(bank: number, value: string): void {
            const routes = listFor(bank, null).routes;
            const route = routes[Math.max(0, Math.min(routes.length - 1, parseInt(value, 10) || 0))];
            if (!route || !route.target) clearLfoTarget(scope, bank);
            else assignLfoTarget(scope, bank, route.target, route.param);
        },
        format(bank: number, raw: string | null, surface: 'cell' | 'header'): string | null {
            const long = listFor(bank, null).options[parseInt(raw || '0', 10) || 0];
            if (long === undefined) return null;
            const at = long.indexOf(': ');
            return surface === 'header' || at < 0 ? long : long.slice(at + 2);
        },
    };
}
