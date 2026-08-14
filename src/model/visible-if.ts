/* `visible_if` — a module hiding a parameter that does not apply right now.
 * mrsample hides Loop Start/End/Xfade until Loop is on; mrdrums swaps whole
 * pad pages the same way.
 *
 * Hidden params are dropped from the page entirely rather than greyed: a knob
 * that edits nothing is worse than one that is not there, and a dropped param
 * leaves a null cell, which is already how knob-leds.ts decides to darken a
 * knob. So the LED goes out for free.
 *
 * Evaluated against live values at hierarchy-build time; watchedKeys() gives
 * the controlling params so a change can force the page to be rebuilt. */

import type { RawMeta } from './param-build.js';

export interface VisibleIf { param: string; equals: string }

export function visibleIfOf(def: RawMeta | undefined): VisibleIf | null {
    const v = def?.visible_if;
    if (!v || typeof v !== 'object') return null;
    const cond = v as { param?: unknown; equals?: unknown };
    if (typeof cond.param !== 'string' || cond.param.length === 0) return null;
    return { param: cond.param, equals: String(cond.equals ?? '') };
}

/* A module may report an enum either as its option NAME ("on") or as its
 * index ("1"), and which one arrives varies by module — so accept both, using
 * the controlling param's own option list to bridge them. */
export function conditionHolds(
    cond: VisibleIf, rawValue: string | null, controllerOptions: string[] | null,
): boolean {
    if (rawValue === null) return true;   // unknown → show, never hide by accident
    const want = cond.equals.trim().toLowerCase();
    const got = rawValue.trim().toLowerCase();
    if (got === want) return true;
    if (controllerOptions) {
        const idx = Number(got);
        if (Number.isFinite(idx) && idx >= 0 && idx < controllerOptions.length) {
            if (String(controllerOptions[idx]).trim().toLowerCase() === want) return true;
        }
        /* The reverse: value is a name, the condition names an index. */
        const wantIdx = Number(want);
        if (Number.isFinite(wantIdx) && wantIdx >= 0 && wantIdx < controllerOptions.length) {
            if (String(controllerOptions[wantIdx]).trim().toLowerCase() === got) return true;
        }
    }
    return false;
}

/* Every param named by a visible_if anywhere in the module's defs. */
export function watchedKeys(defs: Record<string, RawMeta>): string[] {
    const out: string[] = [];
    for (const def of Object.values(defs)) {
        const c = visibleIfOf(def);
        if (c && out.indexOf(c.param) < 0) out.push(c.param);
    }
    return out;
}
