/* schwung-preset-knob.ts — knob 1 on a Schwung preset door (SP-44).
 *
 * A preset door has no knobs (`p.keys` is empty), so `onKnobTurn` bails for
 * every slot there and knob 1 is free to be the preset knob. The list itself is
 * still walked by the controller's own `stepPreset` (flush, write, re-read the
 * name, arm the contract settle), reached through `onJog` — only the knob's
 * feel (`listKnobStep`) and the bank step are movy's.
 */

import type { PageParamSource } from './schwung-page-source.js';
import type { PageHierarchy } from './schwung-page-hierarchy.js';
import { countDetents } from '../seq/detent.js';

export interface PresetKnob {
    /** Turn knob 1 on the page on screen. False when it is not a preset door. */
    turn(delta: number, shift: boolean): boolean;
    /** Where knob 1 sits in the preset list (0..1) on a door, else null. */
    level(): number | null;
}

interface BankItem { index: number }

function parseItems(raw: string | null): BankItem[] {
    try {
        const v = raw ? JSON.parse(raw) : null;
        return Array.isArray(v) ? v.map((it: any, i: number) =>
            ({ index: it && typeof it.index === 'number' ? it.index : i })) : [];
    } catch { return []; }
}

export function createPresetKnob(ctl: any, lib: any, port: PageParamSource,
                                 qualify: (k: string) => string,
                                 hier: PageHierarchy): PresetKnob {
    /* One state per page name, not one per controller: `stepPreset` resets
     * nothing about the turn rate on a re-plan, so neither does this. */
    const listState = new Map<string, any>();
    const bankAccum: number[] = [];

    /*
     * KNOB 1 IS THE PRESET KNOB ONLY WHERE NOTHING ELSE HAS CLAIMED IT. A
     * module-drawn browser (monksynth's face) carries the level's knobs on the
     * same page; there knob 1 is the module's first knob.
     */
    const doorPage = (): any => {
        const p = ctl.page;
        if (!p || p.kind !== lib.PAGE_PRESET) return null;
        return Array.isArray(p.keys) && p.keys[0] ? null : p;
    };

    /*
     * THE BANK IS WHAT THE CONTRACT SAYS IT IS: an items level with a
     * `select_param` that leads to the preset level — by `navigate_to` (obxd's
     * `banks` -> root) or by being one of its entries (dexed's `banks`). A
     * child selector or a mode list is an items page too, and is neither.
     */
    const bankPage = (p: any): any => {
        const entries: any[] = hier.peek()?.levels?.[p.level]?.params ?? [];
        const linked = (lvl: string): boolean =>
            entries.some((e) => e && typeof e === 'object' && e.level === lvl);
        return (ctl.pages as any[] || []).find((q) => q && q.kind === lib.PAGE_ITEMS
            && q.itemsParam && q.selectParam && !q.childOf && !Array.isArray(q.derivedLabels)
            && (q.navigateTo === p.level || linked(q.level))) ?? null;
    };

    /* Leave the door as it was: the knob is a gesture, not a click in. The
     * entered state is the controller's own field (`menuEntered`), borrowed for
     * the one step rather than going through enterMenu/exitMenu — both speak,
     * and a spin would say the page name between every preset. */
    const stepList = (dir: number, n: number): void => {
        const s = ctl.state;
        const was = s.menuEntered;
        s.menuEntered = ctl.page.name;
        try { for (let i = 0; i < n; i++) ctl.onJog(dir, { shift: false }); }
        finally { s.menuEntered = was; }
    };

    /*
     * SHIFT STEPS THE BANK, as Schwung's sound_generator_ui does on
     * Shift+Left/Right: wrap at the ends, and land on the bank's FIRST preset.
     * A module with no bank (or only one) gets a plain preset step, which is
     * also what Schwung's falls through to.
     */
    const stepBank = (p: any, q: any, delta: number): boolean => {
        const banks = parseItems(port.getParam(qualify(q.itemsParam)));
        if (banks.length < 2) return false;
        const steps = countDetents(bankAccum, 0, delta, lib.DETENTS_PER_ENTRY || 6);
        if (!steps) return true;
        const cur = parseInt(port.getParam(qualify(q.selectParam)) ?? '', 10);
        const at = Math.max(0, banks.findIndex((b) => b.index === cur));
        const next = ((at + steps) % banks.length + banks.length) % banks.length;
        /* A pending knob write belongs to the sound being left — the same
         * flush-first rule `stepPreset` keeps — and every cached value now
         * describes it. */
        ctl.revalue();
        port.setParam(qualify(q.selectParam), String(banks[next].index));
        port.setParam(qualify(p.listParam), '0');
        const s = ctl.state;
        const st = s.preset && s.preset[p.name];
        if (st) { st.index = 0; st.name = null; }
        s.settleUntil[p.listParam] = s.tickCount + (lib.SETTLE_TICKS || 9);
        ctl.selectionChanged();
        return true;
    };

    return {
        turn(delta: number, shift: boolean): boolean {
            const p = doorPage();
            if (!p) return false;
            if (shift) {
                const q = bankPage(p);
                if (q && stepBank(p, q, delta)) return true;
            }
            if (typeof lib.listKnobInit !== 'function' || typeof lib.listKnobStep !== 'function') return false;
            let st = listState.get(p.name);
            if (!st) { st = lib.listKnobInit(); listState.set(p.name, st); }
            /* The count is the door's, read the SAME way the controller reads
             * it — through the port every value on this page comes from. */
            const raw = port.getParam(qualify(p.countParam));
            const length = raw ? (parseInt(raw, 10) || 0) : 0;
            const steps = lib.listKnobStep(st, delta, Date.now(), length);
            if (steps) stepList(steps > 0 ? 1 : -1, Math.abs(steps));
            return true;
        },
        /* The controller's own cursor, so the LED moves with the list the
         * screen shows. A count not read yet still lights it, at the bottom:
         * the knob already works, and a dark LED would say it does not. */
        level(): number | null {
            const p = doorPage();
            if (!p) return null;
            const st = ctl.state && ctl.state.preset ? ctl.state.preset[p.name] : null;
            return st && st.count > 1 ? Math.min(1, Math.max(0, st.index / (st.count - 1))) : 0;
        },
    };
}
