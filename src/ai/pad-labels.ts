/* What a drum track's rack says about each of its pads, pitch → text, for the
 * generators to read as parts (gen/analysis/kit.ts):
 *
 *   names   the voice names the module declares;
 *   roles   the roles it declares (schwung's free-form `role`);
 *   labels  what each pad holds right now — the sample it plays, or the value
 *           of a per-pad choice whose options name drums: a voice's algorithm
 *           ("Hat"), its starting sound ("Kick 3"), its wave ("Snare").
 *
 * Only params like that are read, so a rack whose pads hold nothing nameable
 * costs no read at all, and the rest is ONE bulk get for the whole rack.
 * `drum-layouts.json` stands in, per module, for a declaration the module
 * does not make; it is never consulted where the module says anything. */

import { appState } from '../app/state.js';
import { drumNoteOfPad } from '../keyboard/drum-grid.js';
import { portFor } from '../track/registry.js';
import { roleOfText } from '../gen/analysis/drum-lexicon.js';
import LAYOUTS from '../modules/drum-layouts.json';
import type { DrumConfig } from '../types/param.js';

export interface PadHints {
    padNames: Record<number, string> | null;
    padRoles: Record<number, string> | null;
    padLabels: Record<number, string> | null;
}

interface Layout { names?: string[]; roles?: string[]; valueNames?: Record<string, string[]> }
interface PadKeyDef { key: string; alias: string | null; type: string; options: string[] | null }

const NONE: PadHints = { padNames: null, padRoles: null, padLabels: null };

/* Pad-ordered text → pitch → text, '' meaning nothing said. */
function byPitch(list: readonly string[] | undefined, cfg: DrumConfig): Record<number, string> | null {
    if (!list || !list.some((n) => n)) return null;
    const out: Record<number, string> = {};
    list.forEach((n, i) => { if (n && i < cfg.padCount) out[drumNoteOfPad(i + 1, cfg)] = n.toUpperCase(); });
    return out;
}

/* A file the pad plays, or a choice with at least one drum among its options.
 * A choice of filter types or play modes says nothing about the drum. */
const names = (d: PadKeyDef) => d.type === 'file' || d.type === 'filepath' || !!d.options?.some((o) => roleOfText(o));

/* An enum reads back as its label from most modules and as its index from
 * some; both mean the same option. */
function asText(d: PadKeyDef, v: string | null): string {
    if (!v) return '';
    return d.options && /^\d+$/.test(v) ? d.options[Number(v)] ?? v : v;
}

function labels(t: number, model: any, cfg: DrumConfig, layout: Layout | undefined): Record<number, string> | null {
    if (typeof model.padKeyDefs !== 'function') return null;
    const asks: { pitch: number; def: PadKeyDef }[] = [];
    for (let pad = 1; pad <= cfg.padCount; pad++) {
        for (const d of model.padKeyDefs(pad) as PadKeyDef[]) {
            const def = { ...d, options: d.options ?? layout?.valueNames?.[d.alias ?? d.key] ?? null };
            if (names(def)) asks.push({ pitch: drumNoteOfPad(pad, cfg), def });
        }
    }
    if (!asks.length) return null;
    const comp = model.getComponentKey();
    const vals = portFor(t).getMany(asks.map((a) => comp + ':' + a.def.key));
    const out: Record<number, string> = {};
    asks.forEach((a, i) => {
        const text = asText(a.def, vals[i]);
        /* The first thing a pad holds that names a drum speaks for it. */
        if (text && !(a.pitch in out && roleOfText(out[a.pitch]))) out[a.pitch] = text.toUpperCase();
    });
    return Object.keys(out).length ? out : null;
}

/** Everything track `t`'s rack says about its pads. */
export function padHints(t: number): PadHints {
    const model = appState.trackModels[t]?.[1];
    const cfg = model?.getDrumConfig();
    if (!model || !cfg) return NONE;
    const layout = (LAYOUTS as Record<string, Layout>)[model.getModuleId?.() ?? ''];
    const said = {
        padNames: byPitch(model.getDrumPadNames(), cfg),
        padRoles: byPitch(model.getDrumPadRoles?.(), cfg),
        padLabels: labels(t, model, cfg, layout),
    };
    if (said.padNames || said.padRoles || said.padLabels) return said;
    return { padNames: byPitch(layout?.names, cfg), padRoles: byPitch(layout?.roles, cfg), padLabels: null };
}
