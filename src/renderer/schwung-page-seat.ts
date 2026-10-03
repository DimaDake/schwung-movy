/* schwung-page-seat.ts — the per-pad seat, the jog order and the pad-switch
 * rule (plan 2026-09-30, D5/D6/D7/D12).
 *
 * movy owns NAVIGATION, Schwung owns the PAGE (D5). The controller plans every
 * page of the module in declaration order; this layer only re-orders the jog
 * over those real indices and never touches a page itself:
 *
 *   - THE SEAT. A sibling rack (6w6/9w9/cw78) plans one level per voice, so its
 *     jog walked eight drum pages before reaching Reverb. Those collapse into
 *     ONE seat that shows the focused voice's page(s). A template rack
 *     (simian/dr32) already has one seat per child level — the controller
 *     re-keys it per pad — so its block is every page of every level on the
 *     rack's index param, which is how lane_voice_map.mjs groups dr32's
 *     Shape/Mix levels with the note-carrying Pad level.
 *   - THE ORDER (D6). The focused voice's block first, then every other page in
 *     the planner's order. The bank bar's count and index are this order's.
 *   - THE PRESS (D7). On a block page a pad press keeps the offset within the
 *     block, clamped to the new voice's last page. Anywhere else the page stays,
 *     but the seat still moves: jogging back to it shows the pad last hit.
 *
 * THE SEAT IS ADOPTED, NOT IMPOSED. The section picker can land on any real
 * page — another voice's Snare page included — and that page must still have a
 * place in the order, so landing on a voice's page makes it the seat.
 *
 * Nothing here reads the module: the voices come from the contract the
 * controller planned from (`peek`), so a press costs no round trip (D12).
 */

import { surfaceOf, type Voice } from './schwung-voices.js';
import type { PageHierarchy } from './schwung-page-hierarchy.js';

export interface PageSeat {
    /** Is there a seat at all — has the module declared voices with pages? */
    active(): boolean;
    count(): number;
    /** The jog position of the controller's current page. */
    index(): number;
    /** The real page at jog position `i`. */
    realOf(i: number): number;
    /** The real page one jog step away, or -1 at either end. */
    step(dir: number): number;
    /** A pad press (1-based): the real page to turn to, or -1 to stay (D7). */
    press(pad: number): number;
    /** Every voice's keys on its own block, qualified and resolved per voice —
     *  what a pad switch will read (D12). Same array until the plan changes. */
    keys(): readonly string[];
    /** Once per contract: the seat's first page, if the controller is still
     *  where it landed by itself; else -1. */
    landing(): number;
    /** Is the controller's page on the seated voice's block — a page a pad
     *  press re-targets? False without a seat. */
    onBlock(): boolean;
}

interface Plan {
    voices: Voice[];
    /** Real page indices per voice, in planner order. */
    blocks: number[][];
    /** Real indices on no voice's block, in planner order. */
    others: number[];
    keys: string[];
}

export function createPageSeat(ctl: any, lib: any, hier: PageHierarchy,
                               qualify: (k: string) => string): PageSeat {
    let fromH: any = undefined;
    let fromPages: any = undefined;
    let fromLen = -1;
    let plan: Plan | null = null;
    let seat = -1;
    /* THE SEAT IS PAGE ONE (D6), so a module opens on it — but only once per
     * contract, and only while the controller is still on the page it chose
     * itself: a replan, or a page the user jogged to, is never yanked back. */
    let landFor: any = null;
    let landedFor: any = null;
    let landFrom = -1;

    const indexParam = (lvl: any): string | null =>
        (lvl && typeof lib.childIndexParam === 'function' ? lib.childIndexParam(lvl) : null) || null;

    function build(h: any, pages: any[]): Plan | null {
        const voices = surfaceOf(h).voices;
        if (!voices.length || !pages.length) return null;
        const levels = (h && h.levels) || {};
        const blocks = voices.map((v) => blockOf(v, levels, pages));
        if (!blocks.some((b) => b.length)) return null;
        const inBlock = new Set<number>();
        for (const b of blocks) for (const i of b) inBlock.add(i);
        const others: number[] = [];
        for (let i = 0; i < pages.length; i++) if (!inBlock.has(i)) others.push(i);
        return { voices, blocks, others, keys: keysOf(voices, blocks, pages) };
    }

    /* A sibling voice owns its level's pages. A child voice owns every page of
     * every level on its level's index param: they are the same pads. A voice
     * the planner did not name by level is found by NAME, as before. */
    function blockOf(v: Voice, levels: any, pages: any[]): number[] {
        const out: number[] = [];
        const ip = v.childIndex !== null && v.childIndex !== undefined ? indexParam(levels[v.level]) : null;
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            if (!p) continue;
            if (p.level === v.level || (ip && p.childLevel && indexParam(levels[p.level]) === ip)) out.push(i);
        }
        if (out.length) return out;
        const want = String(v.name || '').toUpperCase();
        const byName = want ? pages.findIndex((p) => p && String(p.name || '').toUpperCase() === want) : -1;
        return byName >= 0 ? [byName] : [];
    }

    function keysOf(voices: Voice[], blocks: number[][], pages: any[]): string[] {
        const seen = new Set<string>();
        voices.forEach((v, vi) => {
            for (const i of blocks[vi]) {
                const p = pages[i];
                for (const k of (Array.isArray(p.keys) ? p.keys : [])) {
                    if (!k) continue;
                    const at = v.childIndex;
                    const c = (p.childLevel && at !== null && at !== undefined && typeof lib.resolveChildKey === 'function')
                        ? (lib.resolveChildKey(p.childLevel, at, k) || k) : k;
                    seen.add(qualify(c));
                }
            }
        });
        return [...seen];
    }

    function current(): Plan | null {
        const h = hier.peek();
        const pages = ctl.pages || [];
        if (h !== fromH || pages !== fromPages || pages.length !== fromLen) {
            fromH = h; fromPages = pages; fromLen = pages.length;
            plan = h ? build(h, pages) : null;
            if (!plan || seat >= plan.voices.length) seat = -1;
            if (plan && h !== landedFor && h !== landFor) { landFor = h; landFrom = ctl.pageIndex; }
        }
        if (!plan) return null;
        /* Adopt the page the controller is on when it belongs to a voice the
         * seat is not showing (the picker, a first plan). */
        const at = ctl.pageIndex;
        if (seat < 0 || plan.blocks[seat].indexOf(at) < 0) {
            const w = plan.blocks.findIndex((b) => b.indexOf(at) >= 0);
            if (w >= 0) seat = w;
            else if (seat < 0) seat = plan.blocks.findIndex((b) => b.length > 0);
        }
        return plan;
    }

    const order = (p: Plan): number[] => p.blocks[seat].concat(p.others);

    return {
        active: () => current() !== null,
        count() { const p = current(); return p ? order(p).length : (ctl.pages ? ctl.pages.length : 0); },
        index() {
            const p = current();
            if (!p) return ctl.pageIndex;
            const i = order(p).indexOf(ctl.pageIndex);
            return i >= 0 ? i : 0;
        },
        realOf(i: number) {
            const p = current();
            if (!p) return i;
            const o = order(p);
            return o[Math.max(0, Math.min(o.length - 1, i))];
        },
        /* Does not wrap, like page_nav's `step`: an overshoot keeps its place. */
        step(dir: number) {
            const p = current();
            if (!p) return -1;
            const o = order(p);
            const i = o.indexOf(ctl.pageIndex) + (dir > 0 ? 1 : -1);
            return i >= 0 && i < o.length && o.indexOf(ctl.pageIndex) >= 0 ? o[i] : -1;
        },
        press(pad: number) {
            const p = current();
            const v = pad - 1;
            if (!p || v < 0 || v >= p.voices.length || !p.blocks[v].length) return -1;
            const off = seat >= 0 ? p.blocks[seat].indexOf(ctl.pageIndex) : -1;
            seat = v;
            if (off < 0) return -1;
            const b = p.blocks[v];
            return b[Math.min(off, b.length - 1)];
        },
        keys() { const p = current(); return p ? p.keys : []; },
        landing() {
            const p = current();
            if (!p || landFor === null || landFor === landedFor) return -1;
            landedFor = landFor;
            const b = p.blocks[seat];
            return ctl.pageIndex === landFrom && b.indexOf(ctl.pageIndex) < 0 ? b[0] : -1;
        },
        onBlock() {
            const p = current();
            return !!p && seat >= 0 && p.blocks[seat].indexOf(ctl.pageIndex) >= 0;
        },
    };
}
