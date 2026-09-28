/* lfo-schwung-source.ts — the LFO page Schwung itself draws (SP-60).
 *
 * Schwung's Slot Settings and Master FX Settings grids each carry an LFO 1 and
 * an LFO 2 page, built from `lfoParams`/`lfoLevels` (`schwung-lib.ts`'s
 * `schwungLfoPage`). movy's LFO chain slot edits the SAME two LFOs under the
 * SAME keys — `lfoN:*` on a track, `master_fx:lfoN:*` on the master chain — so
 * under `page` it draws that page, not a lookalike: the waveform across the
 * second row, one Rate cell that swaps with Sync, Target as a door.
 *
 * SP-55 declared its own sixteen cells here and translated each one; that is
 * the second copy Schwung's own header warns is "how the two editors drifted".
 * What is left for movy is only what Schwung's HOST does around the contract:
 *
 *   - keys pass straight through to the scope's port (the declared key IS the
 *     real key; the controller prefixes the component, stripped here);
 *   - `visible` answers the rate cells' `visible_if` against that port;
 *   - Target is a KNOB (`lfo-target-list.ts`): the routings movy can reach,
 *     as one enum. On a Schwung without `lfoTargetOptions` Target stays a door
 *     and the picker below opens movy's list.
 *
 * NOT AUTOMATABLE, unchanged: `schwung-page-render.ts` answers false for any
 * `isLfoComponent` key — an LFO driving another LFO's knob has no engine lane.
 */

import type { PageParamSource, SourcePicker } from '../renderer/schwung-page-source.js';
import { schwungLfoPage } from '../renderer/schwung-lib.js';
import { lfoTargetLists } from './lfo-target-list.js';
import type { LfoScope } from './scope.js';
import { componentKey } from './scope.js';
import { writeLfoKey } from './io.js';
import { assignLfoTarget, clearLfoTarget, lfoTargetEpoch } from './assign.js';
import { buildTargetOptions, targetIndex, compLabel } from './params.js';

const HIER_KEY = 'ui_hierarchy';
const PARAMS_KEY = 'chain_params';
const NONE = 'None';

/* `room_size` -> `Room Size`: a routed param its module no longer declares
 * still says which one it is, as Schwung's `prettifyKey` does. */
const prettify = (k: string): string =>
    k.replace(/[_:]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());

export function lfoSchwungSource(scope: LfoScope): PageParamSource | null {
    const lp = schwungLfoPage();
    if (!lp) return null;       /* no contract to draw: movy's own page stays */

    const prefix = scope.keyPrefix + 'lfo:';
    const real = (k: string): string => (k.startsWith(prefix) ? k.slice(prefix.length) : k);
    const read = (k: string): string | null => scope.port.getParam(k);
    const targetOf = (k: string): number => {
        const m = /lfo([12]):target$/.exec(k);
        return m ? Number(m[1]) - 1 : -1;
    };

    const params = lp.lfoParams(1, scope.keyPrefix).concat(lp.lfoParams(2, scope.keyPrefix));
    const targets = lfoTargetLists(scope, lp, params);
    /* Schwung's own shape — a root that only navigates, and the two LFO
     * levels from the shared builder (`masterGridHierarchy` minus its values
     * and actions, which are Master FX Settings', not the LFOs'). */
    const hierarchy = JSON.stringify({ modes: null, levels: Object.assign({
        root: { label: 'LFO', knobs: [], params: [
            { level: 'lfo1', label: 'LFO 1' }, { level: 'lfo2', label: 'LFO 2' }] },
    }, lp.lfoLevels([1, 2], scope.keyPrefix)) });

    /* THE DRAW PATH READS NOTHING (Schwung's rule — a read is ~2.8ms on
     * device, more than a whole page render). The target component arrives
     * as `raw`, already read by the controller's cursor; `target_param` and
     * the param's NAME cost reads, so they are resolved once per routing and
     * kept until movy writes a routing (`lfoTargetEpoch`), the component
     * changes, or a second passes — the bound on a routing changed elsewhere
     * (an undo) showing stale. */
    const REFRESH_MS = 1000;
    const named: { t: string; epoch: number; at: number; short: string; long: string }[] = [];
    function describe(bank: number, raw: string | null): { short: string; long: string } {
        const t = raw || '';
        const now = Date.now();
        const hit = named[bank];
        if (hit && hit.t === t && hit.epoch === lfoTargetEpoch() && now - hit.at < REFRESH_MS) return hit;
        const p = t ? read(scope.keyPrefix + 'lfo' + (bank + 1) + ':target_param') || '' : '';
        const name = t && p ? paramName(t, p) : NONE;
        named[bank] = { t, epoch: lfoTargetEpoch(), at: now, short: name,
                        long: t && p ? compLabel(t) + ': ' + name : NONE };
        return named[bank];
    }
    function paramName(t: string, p: string): string {
        try {
            const arr = JSON.parse(read(componentKey(scope, t) + ':chain_params') || '[]');
            const hit = Array.isArray(arr) ? arr.find((e: any) => e && e.key === p) : null;
            return String((hit && (hit.name || hit.label)) || prettify(p));
        } catch { return prettify(p); }
    }

    return {
        bulkReads: false,
        getParam(k: string): string | null {
            const r = real(k);
            if (r === HIER_KEY) return hierarchy;
            if (r === PARAMS_KEY) return targets.chainParams();
            const bank = targetOf(r);
            if (bank >= 0 && targets.knob) return targets.read(bank);
            return read(r);
        },
        setParam(k: string, v: string): boolean {
            const r = real(k);
            const bank = targetOf(r);
            if (bank >= 0) {
                /* A door's write is the picker's. */
                if (!targets.knob) return false;
                targets.commit(bank, v);
                return true;
            }
            writeLfoKey(scope, r, v);
            return true;
        },
        formatValue(k: string, raw: string | null, surface: 'cell' | 'header'): string | null {
            const bank = targetOf(real(k));
            if (bank < 0) return null;
            if (targets.knob) return targets.format(bank, raw, surface);
            const d = describe(bank, raw);
            return surface === 'header' ? d.long : d.short;
        },
        /* `equals` / `not_equals` — all the LFO contract declares.
         *
         * A condition param that reads NOTHING (an LFO never written) is at its
         * declared default, and an index enum with none sits at its first
         * option — Sync reads Free. Failing open instead, as Schwung's
         * evaluator does, shows BOTH rate cells: nine keys, and LFO 1 spills
         * onto a page of its own that the jog and an assign then land on. */
        visible(c: any): boolean {
            if (!c || typeof c !== 'object' || !c.param) return true;
            let v = read(String(c.param));
            if (v === null || v === '') {
                const def = params.find((p: any) => p.key === c.param);
                if (def && def.default !== undefined) v = String(def.default);
                else if (def && def.type === 'enum') v = '0';
                else return true;
            }
            if (c.equals !== undefined) return String(v) === String(c.equals);
            if (c.not_equals !== undefined) return String(v) !== String(c.not_equals);
            return true;
        },
        picker(k: string): SourcePicker | null {
            const bank = targetOf(real(k));
            if (bank < 0) return null;
            const opts = buildTargetOptions(scope, bank);
            const cur = targetIndex(opts, read(scope.keyPrefix + 'lfo' + (bank + 1) + ':target') || '',
                                    read(scope.keyPrefix + 'lfo' + (bank + 1) + ':target_param') || '');
            return {
                title: 'LFO ' + (bank + 1) + ' Target',
                options: opts.map((o) => o.label),
                index: cur,
                commit(i: number) {
                    const o = opts[Math.max(0, Math.min(opts.length - 1, i))];
                    if (!o || !o.target) clearLfoTarget(scope, bank);
                    else assignLfoTarget(scope, bank, o.target, o.param!);
                },
            };
        },
    };
}
