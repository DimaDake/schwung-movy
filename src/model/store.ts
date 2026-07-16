import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { KNOBS_PER_PAGE, ENUM_DELTA_DIV, ARC_DELTA_SCALE, REFRESH_SUPPRESS_TICKS } from './constants.js';
import { moduleReadKey } from '../chain/config.js';
import { concreteKey } from './pad-scope.js';
import { enumRawToIndex, enumUsesIndex, enumSetValue } from './enum-value.js';
import { pageSlotMap } from './envelope.js';
import { inferGuessedMeta } from './meta-infer.js';
import { mlog } from '../log.js';

/* First-read type/range inference for guessed params (C4). Mutates p in place
 * (bounds must widen before the value is clamped/seeded) and clears the flag so
 * inference runs once, like the enum-format probe. */
function maybeInferMeta(p: KnobParam, raw: string | null): void {
    if (!p.metaGuessed || raw === null) return;
    const inf = inferGuessedMeta(p, raw);
    if (inf) { p.type = inf.type; p.min = inf.min; p.max = inf.max; p.step = inf.step; }
    delete p.metaGuessed;
}

/* Physical knob (screen slot 0..7) → page-relative param index, honoring the
 * envelope rearrange so a knob always drives the param shown at its position.
 * Cached per page; -1 when the slot holds no param. Cache is invalidated on
 * hierarchy reload (loadHierarchy clears slotMapCache). */
export function slotToLocal(s: ModelState, physK: number): number {
    if (!s.slotMapCache || s.slotMapCache.page !== s.knobPage) {
        const start = s.knobPage * KNOBS_PER_PAGE;
        s.slotMapCache = { page: s.knobPage, map: pageSlotMap(s.knobParams.slice(start, start + KNOBS_PER_PAGE)) };
    }
    return s.slotMapCache.map[physK] ?? -1;
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
    if (s.enumFmt[gi] === undefined) {
        s.enumFmt[gi] = enumUsesIndex(p.options, shadow_get_param(s.activeSlot, s.componentKey + ':' + ioKey));
    }
    return s.enumFmt[gi] as boolean;
}

export function formatValue(p: KnobParam, v: number | null | undefined): string {
    if (p.type === 'file') return '...';
    if (v === null || v === undefined) return '...';
    if (p.type === 'enum') {
        if (p.options && p.options[Math.round(v)]) return p.options[Math.round(v)].substring(0, 5);
        return String(Math.round(v));
    }
    if (p.type === 'int') return String(Math.round(v));
    const range = (p.max - p.min) || 1;
    return Math.round((v - p.min) / range * 100) + '%';
}

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
}

/* Per-knob param facts the automation layer needs. Automatable = numeric range,
 * not a file/global param (globals like g_* aren't reachable as target:param in
 * the chain's knob mapping; see the device spike). */
export function knobParamInfo(s: ModelState, physK: number): KnobParamInfo | null {
    const local = slotToLocal(s, physK);
    if (local < 0) return null;
    const gi = s.knobPage * KNOBS_PER_PAGE + local;
    const p = s.knobParams[gi];
    if (!p) return null;
    const v = s.knobValues[gi];
    return {
        gi, key: p.key, ioKey: paramIoKey(s, p), target: s.componentKey,
        value: (v === null || v === undefined) ? p.min : (v as number),
        min: p.min, max: p.max, type: p.type, automatable: p.automatable,
    };
}

export function applyKnobDelta(s: ModelState, physK: number, delta: number): void {
    const local = slotToLocal(s, physK);
    if (local < 0) return;
    const gi = s.knobPage * KNOBS_PER_PAGE + local;
    const p  = s.knobParams[gi];
    if (!p) return;
    if (p.type === 'file') return;

    const ioKey = paramIoKey(s, p);
    if (s.knobValues[gi] === null || s.knobValues[gi] === undefined) {
        const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + ioKey);
        if (raw === null && !p.key.startsWith('test_')) return;
        maybeInferMeta(p, raw);
        if (p.type === 'enum') {
            s.enumFmt[gi] = enumUsesIndex(p.options, raw);
            s.knobValues[gi] = raw === null ? p.min : enumRawToIndex(p.options, raw);
        } else {
            const v = parseFloat(raw ?? '');
            s.knobValues[gi] = (raw === null || isNaN(v)) ? p.min : v;
        }
    }

    const arcScale = p.renderStyle === 'arc' ? ARC_DELTA_SCALE : 1;
    const scaled = p.type === 'enum' ? delta / ENUM_DELTA_DIV : delta * p.step * arcScale;
    let newVal = (s.knobValues[gi] as number) + scaled;
    newVal = Math.max(p.min, Math.min(p.max, newVal));
    if (p.type === 'int') newVal = Math.round(newVal);
    // enum: store as float for fractional accumulation; read sites use Math.round
    s.knobValues[gi] = newVal;

    const valStr = p.type === 'enum'
        ? enumSetValue(p.options, Math.round(newVal), enumFmtFor(s, gi, p, ioKey))
        : (p.type === 'float') ? newVal.toFixed(4) : String(Math.round(newVal));
    mlog('set slot=' + s.activeSlot + ' gi=' + gi + ' key=' + s.componentKey + ':' + ioKey + ' val=' + valStr);
    const ok = p.key.startsWith('test_') ? true : shadow_set_param(s.activeSlot, s.componentKey + ':' + ioKey, valStr);
    mlog('set_param returned ' + ok);
    s.dirty = true;
}

/* Re-read every pad-scoped param for the current focused pad. Called when the
 * focused pad changes so the knobs immediately show the newly-selected pad's
 * values rather than the previous pad's cached ones. Non-pad params (ioKey ===
 * key) are left untouched. */
export function reseedPadParams(s: ModelState): void {
    const ps = s.moduleConfig?.drum?.padScoping;
    if (!ps) return;
    for (let i = 0; i < s.knobParams.length; i++) {
        const p = s.knobParams[i];
        if (!p) continue;
        const ioKey = concreteKey(ps, s.drumCurrentPad, p.key);
        if (ioKey === p.key) continue; // not pad-scoped
        const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + ioKey);
        if (p.type === 'file') {
            s.fileValues[i] = raw;
        } else if (raw !== null) {
            if (p.type === 'enum') {
                s.enumFmt[i] = enumUsesIndex(p.options, raw);
                s.knobValues[i] = enumRawToIndex(p.options, raw);
            } else {
                const v = parseFloat(raw);
                s.knobValues[i] = isNaN(v) ? p.min : v;
            }
        } else {
            s.knobValues[i] = null;
        }
    }
    s.dirty = true;
}

export function refreshOneParam(s: ModelState, tickCount: number): void {
    if (s.knobParams.length === 0) return;
    if (tickCount - s.lastDeltaTick < REFRESH_SUPPRESS_TICKS) return;

    const i = s.refreshParamCursor % s.knobParams.length;
    s.refreshParamCursor = (i + 1) % s.knobParams.length;

    const p = s.knobParams[i];
    if (!p) return;
    const ioKey = paramIoKey(s, p);

    // Automation lanes / LFO-modulated params are engine-driven; reading them
    // back would overwrite the UI-owned base and repaint every tick. Show base.
    if (s.noRefreshKeys.has(ioKey) || s.modulatedKeys.has(ioKey)) return;

    if (p.type === 'file') {
        const path = shadow_get_param(s.activeSlot, s.componentKey + ':' + ioKey);
        if (path !== s.fileValues[i]) {
            s.fileValues[i] = path;
            s.dirty = true;
        }
        return;
    }

    const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + ioKey);
    if (raw === null) return;
    maybeInferMeta(p, raw);
    if (p.type === 'enum') {
        s.enumFmt[i] = enumUsesIndex(p.options, raw);
        const idx = enumRawToIndex(p.options, raw);
        if (idx !== s.knobValues[i]) { s.knobValues[i] = idx; s.dirty = true; }
        return;
    }
    const newVal = parseFloat(raw);
    if (!isNaN(newVal) && newVal !== s.knobValues[i]) {
        s.knobValues[i] = newVal;
        s.dirty = true;
    }
}

export function pollModuleName(s: ModelState): void {
    const name = shadow_get_param(s.activeSlot, s.componentKey + ':name')
              || shadow_get_param(s.activeSlot, moduleReadKey(s.componentKey))
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
    if (!s.componentKey.startsWith('master_fx')) {
        for (let i = 1; i <= 2; i++) {
            if (shadow_get_param(s.activeSlot, 'lfo' + i + ':target') === s.componentKey) {
                const tp = shadow_get_param(s.activeSlot, 'lfo' + i + ':target_param');
                if (tp) s.modulatedKeys.add(tp);
            }
        }
    }
    if (s.modulatedKeys.size !== prev) s.dirty = true;
}
