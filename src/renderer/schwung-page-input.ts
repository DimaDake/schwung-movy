/* schwung-page-input.ts — every gesture movy forwards to Schwung's controller.
 *
 * SCHWUNG'S OWN INPUT HANDLER, not a copy of it. Click and Back are LADDERS —
 * click is picker/door/no-knob-held/held, Back is hint/peek/picker/menu/exit —
 * and restating either here is how the two would drift. Same reason the binding
 * drives the controller rather than reimplementing its planning.
 *
 * KNOBS DELIBERATELY DO NOT GO THROUGH IT. `applyInput`'s knob intent carries a
 * DIRECTION and moves one detent per call, which is exactly the magnitude bug
 * schwung-knob-feel-check exists to catch ("knobs move very very slowly like
 * shift is held"). movy scales by the encoder's accumulated delta and keeps its
 * own path for that.
 */

import type { PageParamSource } from './schwung-page-source.js';
import type { SchwungIntent } from './schwung-page.js';
import type { PageHierarchy } from './schwung-page-hierarchy.js';
import { mlog } from '../log.js';
import { surfaceOf, padForNote } from './schwung-voices.js';
import type { PageFocus } from './schwung-page-focus.js';
import type { PageSeat } from './schwung-page-seat.js';
/* The detent accumulator the sequencer pages have always used. Imported rather
 * than reimplemented: one rule for "how much raw CC is one click", stated once
 * (`seq/detent.ts`). */
import { countDetents } from '../seq/detent.js';

export interface PageInput {
    knobTurn(slot: number, delta: number): void;
    knobTouch(slot: number, down: boolean): void;
    click(shift?: boolean): SchwungIntent | null;
    back(): SchwungIntent | null;
    focusVoice(pad: number, note?: number): boolean;
    /** The instance of `level` movy's last pad press chose, or null. */
    focusedChild(level: string): number | null;
    /** One jog detent — through movy's seat order where there is one. */
    jog(dir: number): void;
}

export function createPageInput(ctl: any, lib: any, port: PageParamSource,
                                qualify: (k: string) => string,
                                hier: PageHierarchy,
                                warm: (keys: readonly string[]) => void,
                                focus: PageFocus, seat: PageSeat): PageInput {
    /*
     * SP-39. TURN TO A PAGE AND COVER ITS CELLS IN THE SAME BREATH.
     *
     * `ctl.goToPage` runs Schwung's `warmCurrentPage` synchronously, and that
     * asks for every cell of the arriving page it does not already hold — one
     * blocking round trip each, up to eight, on the gesture that turned the
     * page. Measured on device as the whole of the pad-press gap: +0.3 single
     * reads a tick across the press, and the worst frame in the window 14 ->
     * 20.5 ms. The cache cannot see this coming (a key enters its batch only by
     * being asked for), so the one place that does — a jump whose target page is
     * already in hand — hands the keys over first. It is ONE bulk request for
     * the page, and it is spent before the controller spends eight.
     */
    const jump = (i: number, childIndex?: number | null, opts?: { remember: boolean }): void => {
        const p = ctl.pages && ctl.pages[i];
        if (p && Array.isArray(p.keys)) {
            const keys = (p.keys as (string | null)[]).filter((k): k is string => !!k);
            /* A CHILD-LEVEL PAGE LISTS ALIASES; THE READS ARE CONCRETE. Such a
             * page carries `start` and the controller asks for `synth:p01_start`
             * — every key goes through `childResolve`/`fullKey`. `qualify` only
             * prefixes, so warming the alias would cover a key no read looks up.
             *
             * WARM THE INDEX THE CONTROLLER WILL ACTUALLY READ (SP-50), not
             * always the voice movy just pressed. A level with its own
             * `child_index_param` is one movy is about to move — warm at
             * `childIndex`, optimistic, settling on the next poll (unchanged
             * since SP-39). A level with NO such param has no channel movy can
             * drive (`voice-poc`'s `pads`, the one fleet module reaching here):
             * `childIndexFor` never moves off what it already held, so warm at
             * `ctl.childIndexOf(level)` instead — the controller's own answer. */
            const concrete = (k: string): string => {
                if (!p.childLevel || typeof lib.resolveChildKey !== 'function') return k;
                const cip = (p.childLevel as any).child_index_param;
                const at = cip ? childIndex
                    : (typeof ctl.childIndexOf === 'function' ? ctl.childIndexOf(p.level) : 0);
                return (typeof at === 'number') ? (lib.resolveChildKey(p.childLevel, at, k) || k) : k;
            };
            /* Qualified the same way `io.getParam` qualifies what the controller
             * asks for, or the warm covers keys the reads will not look up. */
            warm(keys.map((k) => qualify(concrete(k))));
        }
        ctl.goToPage(i, opts);
    };

    /*
     * SP-44. A preset door has no knobs (`p.keys` is empty), so `keyAt` — and
     * therefore `onKnobTurn` — bails at the top for EVERY slot on this page
     * kind, entered or not: turning knob 1 there has never done anything.
     *
     * `ctl.onJog` already walks the list once the door is entered
     * (`stepPreset`, the door's own commit path: flush, write, re-read the
     * name, arm the contract settle) — that part is not restated here, only
     * REACHED from a second gesture. What onJog does not have is a knob's
     * feel: it moves exactly one entry per call, which is the jog's
     * 1-detent-is-1-entry rule and is "way too fast" applied to a knob's
     * dozens-of-detents-per-flick (`list_knob.mjs`'s own opening comment).
     * `listKnobStep` (imported wholesale, not reimplemented) turns the raw
     * signed delta into a step count first; this loop then spends that many
     * `onJog` calls, one per entry, same as a jog would.
     *
     * One state per page name, not one per controller: `stepPreset` resets
     * nothing about the turn rate on a re-plan, so neither does this.
     */
    const presetKnobState = new Map<string, any>();

    /* One banked remainder per knob, for a source that charges more than one
     * raw unit per detent (`PageParamSource.rawPerDetent`). It lives in the
     * binding because that is where a gesture's state already lives, beside
     * `presetKnobState` — and it is `seq/detent.ts`'s accumulator, reused
     * rather than restated: a remainder that carries across CC events is the
     * whole rule, and dropping one is what made a movy knob move on one turn
     * direction and not the other. */
    const turnAccum: number[] = [];
    const turnPresetDoor = (p: any, delta: number): boolean => {
        if (!p || p.kind !== lib.PAGE_PRESET) return false;
        if (typeof lib.listKnobInit !== 'function' || typeof lib.listKnobStep !== 'function') return false;
        if (typeof ctl.menuEntered === 'function' && !ctl.menuEntered()) ctl.enterMenu();
        let st = presetKnobState.get(p.name);
        if (!st) { st = lib.listKnobInit(); presetKnobState.set(p.name, st); }
        /* The count is the door's, read the SAME way the controller reads it
         * — through the port every value on this page already comes from —
         * not re-derived or cached a second time here. */
        const raw = port.getParam(qualify(p.countParam));
        const length = raw ? (parseInt(raw, 10) || 0) : 0;
        const steps = lib.listKnobStep(st, delta, Date.now(), length);
        if (!steps) return true;
        const dir = steps > 0 ? 1 : -1;
        for (let i = 0; i < Math.abs(steps); i++) ctl.onJog(dir, { shift: false });
        return true;
    };

    return {
        /*
         * ONE DETENT PER UNIT OF DELTA. Move's encoders accumulate: a quick
         * flick arrives as a single CC carrying 3, 6, more. movy scales by that
         * magnitude; `onKnobTurn` takes a DIRECTION and moves one detent, so
         * collapsing to +-1 threw the rest away and the knob moved at the speed
         * of the slowest possible turn whatever you did with it. Reported as
         * "knobs move very very slowly like shift is held" — which is what it
         * feels like, though `fine` is never set on this path: measured, movy
         * travelled 0.30 where this travelled 0.005 for the same gesture.
         *
         * Schwung's own host collapses to +-1 too and feels right, because it
         * is fed by a path that has already expanded the accumulation. This one
         * is not, so it expands it here.
         *
         * Capped because a delta arrives as a signed byte: a garbled CC should
         * cost a bounded number of steps, not 63 of them.
         */
        knobTurn: (slot: number, delta: number) => {
            /* SP-44: knob 1 only — the product ask is specifically "knob 1
             * changes presets", not every knob touching an inert door. */
            if (slot === 0 && turnPresetDoor(ctl.page, delta)) return;
            const dir = delta > 0 ? 1 : -1;
            /*
             * THE CAP MUST NOT BITE A REAL GESTURE. `onKnobTurn` moves one
             * detent, so the encoder's magnitude is replayed as that many
             * calls — this is the fix for "knobs move very very slowly like
             * shift is held", and a clamp below the largest real delta
             * reintroduces the same bug for fast turns only.
             *
             * The shadow UI accumulates and re-encodes a turn as ONE CC in
             * 1..63 / 65..127, so 63 is the largest magnitude that can arrive.
             * The old clamp of 32 silently halved a flick: measured 0.80x
             * movy's travel at delta 40 and 0.51x at 63. 63 is the bound now —
             * still a bound, because a corrupt CC must not spin this loop, but
             * one no honest gesture can reach.
             */
            /*
             * A SOURCE MAY CHARGE MORE THAN ONE RAW UNIT PER DETENT (SP-57).
             *
             * movy's own pages do, because they charged 8 per step before
             * delegation and one-per-unit into `ENUM_DELTA_DIV` made every enum
             * on them twice as fast. A real module's port answers nothing, so
             * the expansion below — and the module feel it was measured
             * against — is untouched.
             */
            const key = typeof ctl.keyAt === 'function' ? ctl.keyAt(slot) : null;
            const per = (key && port.rawPerDetent) ? (port.rawPerDetent(qualify(key)) || 1) : 1;
            let n: number;
            if (per > 1) {
                const steps = countDetents(turnAccum, slot, delta, per);
                if (steps === 0) return;      // banked, not lost — the remainder carries
                n = Math.abs(steps);
            } else {
                n = Math.min(Math.abs(delta) | 0, 63) || 1;
            }
            for (let i = 0; i < n; i++) ctl.onKnobTurn(slot, dir);
        },
        knobTouch: (slot: number, down: boolean) => { ctl.onKnobTouch(slot, down); },
        /*
         * The whole ladder, Schwung's. The old binding was `ctl.onClick()` with
         * no slot and the return discarded, which silently dropped three
         * behaviours: onClick never learned which knob was under the hand (so a
         * divable param could not be opened), the "open" intent went nowhere,
         * and openPicker was never reached — leaving the section picker
         * unreachable on a module with 24 pages.
         */
        click: (shift = false) => lib.applyInput(ctl, { type: 'click', shift },
                                             { nowMs: Date.now() }) ?? null,
        back: () => lib.applyInput(ctl, { type: 'back' }, { nowMs: Date.now() }) ?? null,

        /*
         * A PAD PRESS FOCUSES THAT VOICE, and turns the page by the seat's
         * rule (D7) — `schwung-page-seat.ts` maps voice -> level -> pages.
         *
         * The module's own focus param is written too, so the module agrees
         * about which voice is selected rather than only movy's screen moving.
         * Its value is a LEVEL NAME (voices.mjs), not an index.
         *
         * Only on a press. movy keeps the focused pad authoritative and does
         * NOT follow the DSP during playback — hierarchy.ts records what
         * happened when it did: the engine's playback-drifted pad leaked into
         * the UI and moved the page under the user's hands.
         */
        focusVoice(pad: number, note?: number): boolean {
            /* THE CONTRACT THE PAGES WERE PLANNED FROM, from the one place that
             * knows it. The controller keeps its own copy but does not publish
             * it, and its planned pages do not carry the level they came from —
             * both were assumed and both were wrong, measured on device as
             * `hier=no ... lv0=null`.
             *
             * This used to climb its own ladder off the port (`ui_hierarchy`
             * then `ui_pages`), which was right until movy could supply a
             * contract of its own: a rack paged from a translated config
             * (SP-14) would have had its named pages here and NO voices, so the
             * page would not follow the pad — the exact symptom, one layer
             * further in. */
            /* PEEK FIRST (D12): the press must not read. The controller
             * re-reads the contract on its own poll, so the last read is the
             * one its pages were planned from. */
            const hierarchy = hier.peek() ?? hier.parsed();
            const s = surfaceOf(hierarchy);
            /* BY THE NOTE THE PAD SOUNDED where the caller knows it: a config
             * that wins (D4) may number the declared voices differently (9w9's
             * 45/46), and the page must show the voice the pad played. */
            const byNote = note === undefined ? null : padForNote(s, note);
            const vi = byNote ?? pad - 1;
            const v = s.voices[vi];
            if (!hierarchy || !v) return false;
            /* MOVY'S PRESS IS THE ANSWER, NOT THE MODULE'S REPORT (plan D8).
             * The controller learns the new instance when it reads
             * `child_index_param` back — from movy's focus, not the module —
             * a tick on; a lane bound in that window took the PREVIOUS pad's
             * key, so the page asks `focus.focusedChild` first. */
            if (v.level && v.childIndex !== null && v.childIndex !== undefined) {
                focus.choose(v.level, v.childIndex);
            }

            /* A level with several voices addresses them by its own child index
             * param — four toms on one page are one page, four children. */
            if (v.childIndex !== null && v.childIndex !== undefined) {
                const lvl = hierarchy.levels && hierarchy.levels[v.level];
                const cip = lvl && lvl.child_index_param;
                if (cip) {
                    /* `child_index_base` shifts the wire value (SP-50): a raw
                     * `String()` is one below a level declaring base 1. Same
                     * pairing the read path already trusts (`childIndexFromWire`). */
                    const wire = typeof lib.childIndexToWire === 'function'
                        ? lib.childIndexToWire(lvl, v.childIndex) : String(v.childIndex);
                    port.setParam(qualify(cip), wire);
                }
            }
            if (s.focusParam) port.setParam(qualify(s.focusParam), v.level);

            /* THE PAD-SWITCH RULE (D7), the seat's: on a per-pad page the press
             * keeps the offset within the block, clamped; anywhere else the
             * page stays and only the seat moves. A template rack's block is
             * the same pages for every pad, so it usually stays put and the
             * controller re-keys the cells. `remember: false` — the offset is
             * the rule, not the section's remembered sub-page. */
            const to = seat.press(vi + 1);
            if (to >= 0 && to !== ctl.pageIndex) jump(to, v.childIndex, { remember: false });
            else if (to < 0 && !seat.active()) mlog('focusVoice no page for ' + v.level + '/' + v.name);
            return true;
        },
        focusedChild: focus.focusedChild,
        /* The seat re-orders only the PAGE step. A picker or an entered door
         * owns the jog itself — `onJog`'s own ladder, all of it behind those
         * two questions — so those go to it untouched. The page step's own
         * side effects (`onJog` drops a hint and the enum peek) are kept. */
        jog(dir: number) {
            const entered = typeof ctl.menuEntered === 'function' && ctl.menuEntered();
            if (!seat.active() || ctl.pickerOpen || entered) { ctl.onJog(dir); return; }
            const to = seat.step(dir);
            if (to < 0) return;
            if (ctl.state && ctl.state.hintLines && typeof ctl.dismissHint === 'function') ctl.dismissHint();
            if (typeof ctl.dismissPeek === 'function') ctl.dismissPeek();
            const p = ctl.pages[to];
            const lvl = p && p.childLevel && hier.peek()?.levels?.[p.level];
            const at = lvl && lvl.child_index_param ? focus.focusedChild(p.level) : null;
            jump(to, at, { remember: false });
        },
    };
}
