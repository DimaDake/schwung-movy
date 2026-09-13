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

import type { TrackPort } from '../track/port.js';
import type { SchwungIntent } from './schwung-page.js';
import { mlog } from '../log.js';
import { surfaceOf } from './schwung-voices.js';

export interface PageInput {
    knobTurn(slot: number, delta: number): void;
    knobTouch(slot: number, down: boolean): void;
    click(shift?: boolean): SchwungIntent | null;
    back(): SchwungIntent | null;
    focusVoice(pad: number): boolean;
}

export function createPageInput(ctl: any, lib: any, port: TrackPort,
                                qualify: (k: string) => string): PageInput {
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
            const n = Math.min(Math.abs(delta) | 0, 63) || 1;
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
         * A PAD PRESS SHOWS THAT VOICE'S PAGE.
         *
         * The rack declares its voices in order and each names the LEVEL it
         * lives on; the planner names the same level on the page it built for
         * it. So the jump is a lookup, not a guess: voice -> level -> page.
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
        focusVoice(pad: number): boolean {
            /* READ THE CONTRACT FROM THE PORT, as movy's model does. The
             * controller keeps its own copy but does not publish it, and its
             * planned pages do not carry the level they came from — both were
             * assumed and both were wrong, measured on device as
             * `hier=no ... lv0=null`. Same two keys movy uses: a module that
             * ships its own chain editor serves the first empty and publishes
             * under the second. */
            let raw = port.getParam(qualify('ui_hierarchy'));
            if (!raw) raw = port.getParam(qualify('ui_pages'));
            let hierarchy: any = null;
            try { hierarchy = raw ? JSON.parse(raw) : null; } catch (_e) { hierarchy = null; }
            const s = surfaceOf(hierarchy);
            const v = s.voices[pad - 1];
            if (!hierarchy || !v) return false;

            /* A level with several voices addresses them by its own child index
             * param — four toms on one page are one page, four children. */
            if (v.childIndex !== null && v.childIndex !== undefined) {
                const lvl = hierarchy.levels && hierarchy.levels[v.level];
                const cip = lvl && lvl.child_index_param;
                if (cip) port.setParam(qualify(cip), String(v.childIndex));
            }
            if (s.focusParam) port.setParam(qualify(s.focusParam), v.level);

            /* Level first, NAME second. The planner names a page after the
             * level it built it from, so when the level itself is not carried
             * the name still identifies it — "Snare" the voice and "Snare" the
             * page are the same declaration read twice. */
            const pages = ctl.pages || [];
            const want = String(v.name || '').toUpperCase();
            let byName = -1;
            for (let i = 0; i < pages.length; i++) {
                const p = pages[i];
                if (!p) continue;
                if (p.level === v.level) { ctl.goToPage(i); return true; }
                if (byName < 0 && want && String(p.name || '').toUpperCase() === want) byName = i;
            }
            if (byName >= 0) { ctl.goToPage(byName); return true; }
            mlog('focusVoice no page for ' + v.level + '/' + v.name
               + ' | keys=' + (pages[1] ? Object.keys(pages[1]).join(',') : '-')
               + ' | p1=' + (pages[1] ? JSON.stringify({n: pages[1].name, l: pages[1].level,
                                                        t: pages[1].title, k: pages[1].kind}) : '-'));
            return false;
        },
    };
}
