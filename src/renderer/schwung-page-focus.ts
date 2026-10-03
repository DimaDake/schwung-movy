/* schwung-page-focus.ts — movy owns the drum focus (plan 2026-09-30, D8).
 *
 * Schwung's controller has two inputs that move the page under the user's
 * hands, and both are reads of the MODULE's focus:
 *
 *   - `focus_param` (sibling racks) — `syncVoiceFromModule` navigates to the
 *     voice the module reports. 6w6/8w8/9w9/cw78 move that focus on every
 *     note-on unless MOVE's clock runs (`er99_plugin.c`), and movy's sequencer
 *     is not Move's clock, so every sequenced hit turned the page.
 *   - `child_index_param` (template racks) — `syncChildIndexFromModule` adopts
 *     the instance the module reports, re-keying every cell. A module that
 *     auto-selects on a note (mrdrums' `ui_auto_select_pad`) moved the knobs
 *     to whichever pad the pattern last played.
 *
 * Both are io reads, and the io is movy's, so the module's answer is replaced
 * here rather than ignored downstream: the focus is what was last WRITTEN
 * through movy — a pad press (`choose`) or the controller's own picker / index
 * knob (`wrote`) — and never what the module reports back. Navigation is
 * movy's alone (`focusVoice`), so `focus_param` answers null: "no information",
 * which the controller treats as nothing to follow, before its latch.
 */

import type { PageHierarchy } from './schwung-page-hierarchy.js';
import type { PageAutomation } from '../types/page-automation.js';

export interface PageFocus {
    /** movy's answer for a focus input the controller reads; undefined when
     *  `fullKey` is not one, so the read falls through to the module. */
    answer(fullKey: string): string | null | undefined;
    /** A write through the io: the controller's picker or the index knob. */
    wrote(fullKey: string, value: string): void;
    /** A pad press chose instance `index` of `level`. */
    choose(level: string, index: number): void;
    /** The instance of `level` movy last chose, or null. */
    focusedChild(level: string): number | null;
    /** The key a read or write of `fullKey` goes to: a movy-config alias at
     *  movy's pad, anything else unchanged. */
    ioKey(fullKey: string): string;
}

export function createPageFocus(hier: PageHierarchy, lib: any,
                                qualify: (k: string) => string,
                                automation: (() => PageAutomation | null) | null): PageFocus {
    /* ONE FOCUS PER INDEX PARAM, NOT PER LEVEL. simian's three child levels
     * (`pads`, `pad_noise`, `pad_mix`) share `ui_current_voice`: one module
     * param, one pad. A level with no index param (voice-poc's `pads`) keeps
     * its own. Keyed to the contract the choice was made against: the page
     * outlives its module, so a choice made against another contract answers
     * nothing — and the parse is a new object exactly then. */
    const byKey = new Map<string, number>();
    const byLevel = new Map<string, number>();
    let parsed: any = null;
    let focusKey: string | null = null;
    const keyOfLevel = new Map<string, string>();
    const defOfKey = new Map<string, any>();

    /* Rebuilt once per parse: `answer` runs on every read the controller
     * makes, so it PEEKS — `parsed()` would read the contract each time, and
     * for a rack serving no `ui_pages` that is an uncached live read per ask. */
    const current = (): any => {
        const h = hier.peek();
        if (h === parsed) return h;
        parsed = h;
        byKey.clear(); byLevel.clear(); keyOfLevel.clear(); defOfKey.clear();
        const fp = h && typeof lib.focusParamOf === 'function' ? lib.focusParamOf(h) : null;
        focusKey = fp ? qualify(fp) : null;
        const levels = (h && h.levels) || {};
        for (const name of Object.keys(levels)) {
            const cip = typeof lib.childIndexParam === 'function' ? lib.childIndexParam(levels[name]) : null;
            if (!cip) continue;
            keyOfLevel.set(name, qualify(cip));
            if (!defOfKey.has(qualify(cip))) defOfKey.set(qualify(cip), levels[name]);
        }
        return h;
    };

    return {
        answer(fullKey: string) {
            if (!current()) return undefined;
            const k = qualify(String(fullKey));
            if (k === focusKey) return null;
            const def = defOfKey.get(k);
            if (!def) return undefined;
            const at = byKey.get(k);
            if (at === undefined) return null;
            return typeof lib.childIndexToWire === 'function' ? lib.childIndexToWire(def, at) : String(at);
        },
        wrote(fullKey: string, value: string) {
            if (!current()) return;
            const k = qualify(String(fullKey));
            const def = defOfKey.get(k);
            if (!def || typeof lib.childIndexFromWire !== 'function') return;
            const i = lib.childIndexFromWire(def, value);
            if (i !== null) byKey.set(k, i);
        },
        choose(level: string, index: number) {
            current();
            const k = keyOfLevel.get(level);
            if (k) byKey.set(k, index); else byLevel.set(level, index);
        },
        focusedChild(level: string) {
            current();
            const k = keyOfLevel.get(level);
            return (k ? byKey.get(k) : byLevel.get(level)) ?? null;
        },
        /* AN ALIAS RACK'S PAGE EDITS MOVY'S PAD, not the module's. `pad_vol`
         * names whichever pad the module has focused, and forge and mrdrums
         * move that focus on every note — sequenced ones included — so the
         * knobs drifted to the pad the pattern last played. The concrete key
         * is the one MOVY mode has always used (`paramIoKey`) and the lane
         * binds (`laneKey`), so the page, the lane and the arc name one key. */
        ioKey: (fullKey: string) => {
            const auto = automation ? automation() : null;
            return auto ? auto.laneKey(fullKey) : fullKey;
        },
    };
}
