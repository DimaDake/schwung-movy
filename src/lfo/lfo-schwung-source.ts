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
 *   - Target's cell/header text (`describeTarget` in Schwung) and its picker
 *     (Schwung's target picker) come from movy's own target list.
 *
 * NOT AUTOMATABLE, unchanged: `schwung-page-render.ts` answers false for any
 * `isLfoComponent` key — an LFO driving another LFO's knob has no engine lane.
 */

import type { PageParamSource, SourcePicker } from '../renderer/schwung-page-source.js';
import { schwungLfoPage } from '../renderer/schwung-lib.js';
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

    /* WHAT A CONDITION KEY (Sync) LAST SAID. An engine chain's read can come
     * back null (the param channel is one racy slot), and a plan asks about
     * Sync once PER RATE CELL: null for one and "1" for the other showed BOTH,
     * pushing Phase to a page of its own and breaking the waveform group — on
     * the device, not in any mock. Every read and write of the key refreshes
     * this, so the controller's own gate read, which is what triggers a
     * re-plan, lands here just before the plan asks. */
    const gates = new Set(params.filter((p: any) => p.visible_if).map((p: any) => String(p.visible_if.param)));
    const seen = new Map<string, { v: string; at: number }>();
    const GATE_FRESH_MS = 50;
    const note = (k: string, v: string | null): void => {
        if (v !== null && v !== '' && gates.has(k)) seen.set(k, { v, at: Date.now() });
    };
    const gateValue = (k: string): string | null => {
        const hit = seen.get(k);
        if (hit && Date.now() - hit.at < GATE_FRESH_MS) return hit.v;
        let v = read(k);
        if (v === null || v === '') v = read(k);     /* one retry: the slot races */
        note(k, v);
        return v !== null && v !== '' ? v : (hit ? hit.v : null);
    };
    /* Schwung's own shape — a root that only navigates, and the two LFO
     * levels from the shared builder (`masterGridHierarchy` minus its values
     * and actions, which are Master FX Settings', not the LFOs'). */
    const hierarchy = JSON.stringify({ modes: null, levels: Object.assign({
        root: { label: 'LFO', knobs: [], params: [
            { level: 'lfo1', label: 'LFO 1' }, { level: 'lfo2', label: 'LFO 2' }] },
    }, lp.lfoLevels([1, 2], scope.keyPrefix)) });
    const chainParams = JSON.stringify(params);

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
            if (r === PARAMS_KEY) return chainParams;
            const v = read(r);
            note(r, v);
            return v;
        },
        setParam(k: string, v: string): boolean {
            const r = real(k);
            /* Target is a door, never a knob — its write is the picker's. */
            if (targetOf(r) >= 0) return false;
            writeLfoKey(scope, r, v);
            note(r, v);
            return true;
        },
        formatValue(k: string, raw: string | null, surface: 'cell' | 'header'): string | null {
            const bank = targetOf(real(k));
            if (bank < 0) return null;
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
            let v = gateValue(String(c.param));
            if (v === null || v === '') {
                const def = params.find((p: any) => p.key === c.param);
                if (def && def.default !== undefined) v = String(def.default);
                else if (def && def.type === 'enum') v = '0';
                else return true;
            }
            /* The answer THIS plan used, so its other cell cannot get another. */
            seen.set(String(c.param), { v: String(v), at: Date.now() });
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
