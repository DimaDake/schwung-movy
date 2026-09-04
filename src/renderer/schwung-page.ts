/* schwung-page.ts — Schwung's controller IS the page. movy keeps its chrome.
 *
 * This file used to plan and draw the grid itself: it called planPages,
 * buildMetaIndex and renderPageMovy directly. That was a SECOND
 * IMPLEMENTATION — the thing this whole exercise exists to remove — and it
 * broke the way second implementations do. renderPageMovy draws knob pages and
 * nothing else, so preset, items, menu and child pages rendered as BLANK.
 * Every one of them already had a renderer in Schwung's page_controller, which
 * this bypassed. Reported from the device as "the presets page doesn't render".
 *
 * Now it wraps `createController` and gets all of it: every page kind, divable
 * params, the section picker, the staggered read cursor, the write and announce
 * throttles, the contract tri-state, the placeholder retry, knob feel. What is
 * left here is what Schwung's own README calls "the whole binding": routing,
 * one tick, one render.
 *
 * movy supplies the HEADER and the FOOTER and nothing else, via `bands`. That
 * is the one place the two UIs deliberately differ — movy's header carries the
 * track, its footer carries movy's gestures, and Schwung knows about neither.
 *
 * THE SEQUENCER STILL TARGETS PARAMETERS, not slots. An automation lane stores
 * `targetParam` (componentKey + ':' + key) and is searched by that string, so
 * re-pagination moves no lane: it follows its parameter onto whatever page
 * Schwung puts it on. `keyAt` is how movy asks which parameter a knob drives.
 */

import type { TrackPort } from '../track/port.js';
import type { AutomationView } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { mlog } from '../log.js';
import { moduleReadKey } from '../chain/config.js';
import { registerModuleWidgets } from './schwung-widgets.js';
import { surfaceOf } from './schwung-voices.js';

import { schwungLib } from './schwung-lib.js';
/*
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


/* movy draws its own header, bank bar and footer; Schwung is asked for the
 * widgets between them.
 *
 * The bank bar used to be Schwung's, on the reasoning that it indexes param
 * pages and movy has no equivalent. Both halves were wrong. movy draws a bank
 * bar on these views unconditionally, so asking for one too STACKED TWO
 * full-width rules — the double bar seen on the device. And movy does have an
 * equivalent: `drawBankBar` just needs the numbers, which `pageCount` and
 * `pageIndex` already publish. So Schwung reports and movy draws, which keeps
 * one visual language for the bar and leaves movy composing it — on the chain
 * view it counts CHAIN SLOTS, which is what that view's jog moves and is not
 * Schwung's to overwrite. */
const BANDS = { header: false, bank: false, footer: false };

/** What Schwung asks the HOST to do. `open` wants an editor for `key`; `exit`
 *  means every layer is down and Back now belongs to movy. */
export interface SchwungIntent {
    action: 'open' | 'exit' | string;
    key?: string;
    fullKey?: string;
    meta?: any;
    options?: string[];
    index?: number;
}

export interface SchwungPage {
    reload(): void;
    tick(): void;
    readonly pageCount: number;
    readonly pageIndex: number;
    changePage(delta: number): void;
    goToPage(i: number): void;
    /** Which Schwung parameter knob `slot` drives right now, bare key or null. */
    keyAt(slot: number): string | null;
    /** Same, component-qualified — the form a lane's targetParam takes. */
    targetAt(slot: number): string | null;
    labelAt(slot: number): string | null;
    /** What movy's automation layer needs about the param at this knob. */
    knobParamInfo(slot: number): any | null;
    render(title: string, auto?: AutomationView, touched?: number): void;
    knobTurn(slot: number, delta: number): void;
    knobTouch(slot: number, down: boolean): void;
    /** Jog click. Returns a host intent ("open") when Schwung asks for one. */
    click(shift?: boolean): SchwungIntent | null;
    /** Back. Null once a layer has been taken down; {action:'exit'} when none was. */
    back(): SchwungIntent | null;
    /** Show the page for a 1-based drum pad. False when it cannot be resolved. */
    focusVoice(pad: number): boolean;
    readonly ready: boolean;
    /** The controller itself, for gestures this binding has not wired yet. */
    readonly ctl: any;
}

export function createSchwungPage(port: TrackPort, componentKey = 'synth'): SchwungPage {
    const qualify = (k: string) => (k.indexOf(':') >= 0 ? k : componentKey + ':' + k);

    /* Injected I/O — rule 1 of param_pages: the library does no param I/O, the
     * caller does every read and write. That is what keeps movy's port the one
     * thing talking to the track. */
    const lib = schwungLib();
    const ctl = lib.createController({
        /*
         * `ui_hierarchy` FALLS BACK TO `ui_pages`, which is what a module
         * shipping its own chain editor publishes under.
         *
         * 9W9 serves `ui_hierarchy` EMPTY on purpose — the shadow UI reaches
         * for the hierarchy editor whenever one is offered, and 9W9's RD-9 pad
         * editor is the point of the module — and publishes the same contract
         * under a key the host does not probe. Its own ui_chain.js does exactly
         * this rewrite to feed this controller; movy is the same kind of caller
         * and needs the same one.
         *
         * Without it the controller planned from `chain_params` alone: 13 pages
         * of "Params - 2", "Params - 3", with no level on any of them, instead
         * of one page per voice named Bass Drum, Snare, Low Tom. Measured on
         * device — it is why a pad press had no page to jump to.
         */
        getParam: (k: string) => {
            const v = port.getParam(qualify(k));
            if (v !== null && v !== undefined && v !== '') return v;
            /* MATCHED ON THE SUFFIX, because the controller asks with the
             * component already on the key — `synth:ui_hierarchy`, not
             * `ui_hierarchy`. Comparing the whole string never matched and the
             * fallback silently never ran. */
            const key = String(k);
            if (!key.endsWith('ui_hierarchy')) return v;
            const alt = port.getParam(qualify(key.replace('ui_hierarchy', 'ui_pages')));
            /*
             * THE FALLBACK MUST NOT DESTROY THE TRI-STATE. The controller reads
             * this key with three answers: JSON = declared, "" = served and
             * empty (give up now), null = the read did not complete (hold and
             * ask again). Returning `alt` unconditionally turned an EMPTY
             * answer — a module that left the slot — into ui_pages' null, so
             * the page held "ready" forever and movy never got the frame back.
             * schwung-late-contract-check caught it; that is the fourth time in
             * this branch a latched verdict has come from collapsing those
             * three answers into two.
             */
            return (alt !== null && alt !== undefined && alt !== '') ? alt : v;
        },
        setParam: (k: string, v: string) => { port.setParam(qualify(k), v); },
        /* movy has its own screen-reader path; nothing to say from here yet. */
        announce: () => {},
    });
    ctl.setLayout(lib.LAYOUT_MOVY);

    let loaded = false;
    let attempts = 0;
    let sinceRetry = 0;

    /*
     * IS THERE A PAGE SET TO DRAW — asked every tick, not decided once.
     *
     * `loaded` used to be set inside reload() alone. Once true it stayed true,
     * so when the module was removed from the slot the controller re-planned to
     * NO PAGES and this still claimed ready: Schwung went on drawing the
     * departed module's page and movy never got the frame back, so the view
     * that should have ejected just sat there. Reported as "if I choose None I
     * do not get kicked out".
     *
     * The tri-state decides the middle case. `contractUnresolved` means the
     * READ failed, which is not news about the module — ejecting on it would
     * throw the user out of a live editor because one param request timed out.
     * So an unresolved read HOLDS the previous verdict, exactly as schwung's
     * own host holds its screen, and only a resolved, genuinely empty plan
     * hands the frame back.
     */
    function refreshLoaded(): void {
        if (ctl.contractUnresolved) return;          /* a failed read empties nothing */
        const has = !!(ctl.pages && ctl.pages.length);
        if (has === loaded) return;
        loaded = has;
        /* Going empty re-arms the retry, so the NEXT module to arrive in the
         * slot is picked up instead of waiting on a spent attempt budget. */
        if (!loaded) { attempts = 0; sinceRetry = 0; }
    }

    function reload(): void {
        ctl.load({ slot: port.track.index, component: componentKey });
        refreshLoaded();
        /*
         * A MODULE'S OWN WIDGET, REGISTERED WHEN ITS CONTRACT ARRIVES.
         *
         * Here rather than on a gesture: upstream registered widgets from the
         * canvas-open path, so an in-grid widget did not appear until the
         * fullscreen view had been opened once and never appeared at all for a
         * module with no canvas param. The contract is the only moment that is
         * always reached and always current — a module swap re-plans through
         * here too, so a new module's widget arrives with its pages.
         *
         * Nothing is read unless the contract declares a `custom:` kind, and a
         * failure is not one: an unregistered kind falls through to the
         * built-in widget by design.
         */
        try {
            const id = port.getParam(moduleReadKey(componentKey));
            if (id) registerModuleWidgets(String(id), ctl.state.chainParams || []);
        } catch (_e) { /* a widget is never worth failing a page plan for */ }
    }
    reload();

    /*
     * A CONTRACT READ THAT CAME BACK EMPTY IS NOT A VERDICT.
     *
     * The page is built while the module is still loading, so the first load
     * sees no hierarchy. Reported from the device as "I opened braids, I see
     * movy UI", with `not-ready pages=0` logged exactly once — the shape of a
     * latched answer rather than a repeated failure.
     *
     * Once loaded, `reloadIfChanged` is the controller's own cheap re-plan (it
     * rebuilds only when the contract fingerprint moves), so a module swap
     * re-plans for free and a steady page costs nothing.
     */
    const RETRY_TICKS = 12;
    const RETRY_LIMIT = 60;

    function tick(): void {
        if (!loaded) {
            sinceRetry++;
            if (attempts < RETRY_LIMIT && sinceRetry >= RETRY_TICKS) {
                sinceRetry = 0; attempts++; reload();
            }
            if (!loaded) return;
        }
        ctl.reloadIfChanged();
        ctl.tick();                 /* exactly one get_param */
        refreshLoaded();            /* the module may have just left the slot */
    }

    function keysOf(): (string | null)[] {
        const p = ctl.page;
        return (p && Array.isArray(p.keys)) ? p.keys : [];
    }
    const keyAt = (slot: number) => (keysOf()[slot] as string) || null;

    return {
        reload, tick,
        get ready() { return loaded; },
        get ctl() { return ctl; },
        get pageCount() { return ctl.pages ? ctl.pages.length : 0; },
        get pageIndex() { return ctl.pageIndex; },
        changePage(delta: number) { ctl.onJog(delta > 0 ? 1 : -1); },
        goToPage(i: number) { ctl.goToPage(i); },
        keyAt,
        targetAt: (slot: number) => { const k = keyAt(slot); return k ? qualify(k) : null; },
        labelAt: (slot: number) => {
            const k = keyAt(slot);
            if (!k || !ctl.metaIndex) return null;
            const m = ctl.metaIndex.getOrGuess(k);
            return String((m && (m.label || m.key)) || k);
        },
        /*
         * THE LANE MUST TARGET SCHWUNG'S PARAMETER, not movy's.
         *
         * movy builds an automation lane from `model.getKnobParamInfo(k)` —
         * its OWN idea of which param knob k drives. Under Schwung pagination
         * that is a different parameter: the two planners put different keys in
         * the same cell (9 of them across the mock presets). Left alone, moving
         * a knob to create a lane would have bound the lane to whatever movy
         * thought was there, which is a silent mis-target rather than a visible
         * failure — the lane would work perfectly, on the wrong param.
         *
         * Shaped as movy's KnobParamInfo (store.ts) so the automation layer
         * needs no special case for where it came from.
         */
        knobParamInfo(slot: number) {
            const k = keyAt(slot);
            if (!k || !ctl.metaIndex) return null;
            const m = ctl.metaIndex.getOrGuess(k);
            if (!m) return null;
            const min = typeof m.min === 'number' ? m.min : 0;
            const max = typeof m.max === 'number' ? m.max : 1;
            const raw = ctl.state && ctl.state.values ? ctl.state.values[k] : undefined;
            const value = raw === undefined || raw === null ? min : parseFloat(String(raw));
            return {
                gi: slot,
                key: k,
                ioKey: k,
                target: componentKey,
                value: isNaN(value) ? min : value,
                min, max,
                type: m.type || (m.kind === 'enum' ? 'enum' : 'float'),
                /* Same rule movy applies: a numeric range is automatable, a
                 * door or a trigger is not. */
                automatable: m.kind !== 'opaque' && !m.writeOnly && !m.readOnly
                             && typeof m.min === 'number' && typeof m.max === 'number',
            };
        },
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

        render(title: string, auto?: AutomationView, _touched = -1) {
            /* A lane with locks marks its cell. Asked BY PARAMETER, which is
             * what makes re-pagination harmless. */
            if (auto) {
                const decs = keysOf().map((k) => {
                    if (!k) return null;
                    const lane = auto.laneForKey(k as string);
                    const on = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
                    if (!on) return null;
                    /*
                     * ON A HELD STEP YOU LOOK AT WHAT THE STEP WILL PLAY, not
                     * at where the knob happens to be. movy has already
                     * resolved the held value per lane; passing only `locked`
                     * marked the cell and then drew the LIVE value underneath
                     * it, which is the one reading a parameter lock must not
                     * show. `decoration.value` is exactly this, and Schwung
                     * already prefers it over the live value.
                     */
                    const held = auto.held ? auto.heldValues.get(lane) : undefined;
                    return held === undefined ? { locked: true }
                                              : { locked: true, value: held };
                });
                ctl.setDecorations(decs.some(Boolean) ? decs : null);
            } else {
                ctl.setDecorations(null);
            }

            const ctx = {
                fillRect: (x: number, y: number, w: number, h: number, c: any) =>
                    fill_rect(x, y, w, h, c ? 1 : 0),
                print: (x: number, y: number, t: string, c: any) => fontPrint(x, y, t, c ? 1 : 0),
                textWidth: (t: string) => fontWidth(t),
            };
            /* No `footer` argument: movy draws its own. Every page kind honours
             * `bands` now that the controller's chrome is one definition. */
            ctl.render(ctx, { title, bands: BANDS });
            /*
             * THE OVERLAYS ARE THE CONTROLLER'S AND IT DRAWS THEM ITSELF — the
             * enum peek that shows a divable enum's whole list while you turn
             * it, and the section picker. It REFUSES to draw without a
             * clearScreen (an overlay interleaved with the grid beneath is two
             * screens at once), so omitting this argument is the same as having
             * no overlays at all — which is what movy had.
             */
            ctl.renderOverlays(ctx, { clearScreen: () => clear_screen() });
        },
    };
}
