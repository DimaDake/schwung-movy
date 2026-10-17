/* What the model still reads from the module for itself: its name, which
 * params a slot LFO targets, and the facts an automation lane needs about a
 * param. Values are not mirrored any more — the page on screen is Schwung's
 * and has its own read cursor. */
import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { moduleReadKey } from '../chain/config.js';
import { masterSuffix } from '../chain/master-prefix.js';
import { concreteKey } from './pad-scope.js';
import { enumUsesIndex } from './enum-value.js';

export interface KnobParamInfo {
    gi: number;
    key: string;
    ioKey: string;       // read/write/automation key (concrete pad key for drums)
    target: string;      // componentKey, e.g. "synth" / "fx1"
    value: number;       // current manual value (defaults to min if unknown)
    min: number;
    max: number;
    type: string;
    automatable: boolean;
    /* An enum's option names and whether its module reads them by name — what
     * an automation lane's bind needs to write the form the module speaks. */
    options?: string[];
    wiresNames?: boolean;
}

/* The key movy uses to read/write/automate a param. For a pad-scoped drum param
 * this is the focused pad's concrete key (e.g. "p03_vol"), so all I/O targets the
 * manually-selected pad regardless of the DSP's own ui_current_pad. Otherwise the
 * param's own key. */
export function paramIoKey(s: ModelState, p: KnobParam): string {
    return concreteKey(s.moduleConfig?.drum?.padScoping, s.drumCurrentPad, p.key);
}

/* Cached enum exchange format for (gi). Learned on every enum read, so this is
 * normally a hit; the get_param probe runs only for an enum never yet read
 * (e.g. committed before its first refresh) — not per turn. */
function enumFmtFor(s: ModelState, gi: number, p: KnobParam, ioKey: string): boolean {
    if (s.moduleConfig?.enumSetIndex) return true;   // DSP writes by index, reads by name
    if (s.enumFmt[gi] === undefined) {
        s.enumFmt[gi] = enumUsesIndex(p.options, s.port.getParam(s.componentKey + ':' + ioKey));
    }
    return s.enumFmt[gi] as boolean;
}

/* What an automation lane's bind needs to write an enum the way this module
 * reads it: the option names, and whether it reads them BY NAME. Null for a
 * param that is not an enum. The format is the cached one, probed at most once
 * per param — the same cache the knob's own writes use, so a lane cannot speak
 * a different convention from the knob. */
export function enumLaneInfo(s: ModelState, gi: number): { options: string[]; wiresNames: boolean } | null {
    const p = s.knobParams[gi];
    if (!p || p.type !== 'enum' || !p.options || p.options.length === 0) return null;
    return { options: p.options, wiresNames: !enumFmtFor(s, gi, p, paramIoKey(s, p)) };
}

export function pollModuleName(s: ModelState): void {
    const name = s.port.getParam(s.componentKey + ':name')
              || s.port.getParam(moduleReadKey(s.componentKey))
              || '—';
    if (name !== s.activeModuleName) {
        s.activeModuleName = name;
        s.hierarchyKey = '';
        s.dirty = true;
    }
}

/* Cache which of this component's params a slot LFO targets. Read on the poll
 * cadence (2 reads normally) instead of per render — see modulatedKeys. Marks
 * the ~ indicator and suppresses read-back so the knob shows its base value. */
export function refreshModulatedKeys(s: ModelState): void {
    const prev = s.modulatedKeys.size;
    s.modulatedKeys.clear();
    /* A master FX component is driven by the MASTER LFOs, which store their
     * target bare (`fx1`, parsed by the shim as a slot number) under the
     * master's own prefix (`mfx:lfoN:`). Skipping master components outright is what left an
     * assigned MFX knob with no mark (SP-60). */
    const bare = masterSuffix(s.componentKey);
    const master = bare !== null;
    const lfoPfx = master ? s.componentKey.slice(0, s.componentKey.length - bare.length) : '';
    const want = master ? bare : s.componentKey;
    for (let i = 1; i <= 2; i++) {
        if (s.port.getParam(lfoPfx + 'lfo' + i + ':target') === want) {
            const tp = s.port.getParam(lfoPfx + 'lfo' + i + ':target_param');
            if (tp) s.modulatedKeys.add(tp);
        }
    }
    if (s.modulatedKeys.size !== prev) s.dirty = true;
}
