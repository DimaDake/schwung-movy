import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { KNOBS_PER_PAGE, ENUM_DELTA_DIV, REFRESH_BULK_TICKS, REFRESH_SUPPRESS_TICKS } from './constants.js';
import { detentsPerStep, perDetentStep } from './knob-step.js';
import { countDetents } from '../seq/detent.js';
import { moduleReadKey } from '../chain/config.js';
import { concreteKey } from './pad-scope.js';
import { enumRawToIndex, enumUsesIndex, enumSetValue } from './enum-value.js';
import { isToggleParam } from './toggle.js';
import { pageSlotMap } from './page-layout.js';
import { inferGuessedMeta } from './meta-infer.js';
import { applyTriggerDelta, seedTriggerState } from './trigger.js';
import { mlog } from '../log.js';
import { setChainParam } from '../chain/set-param.js';
import { beginGesture } from '../undo/edit.js';
import { recordPresetState } from '../undo/record.js';
import { isItemSelector, itemPositionOf } from './items-param.js';

function gestureFor(s: ModelState, key: string) {
    return s.paramGestures[key] ??= { lastTurnMs: 0, direction: 0 };
}

function wideStepCount(s: ModelState, p: KnobParam, delta: number): number {
    if (delta === 0) return 0;
    const now = Date.now();
    const direction = delta > 0 ? 1 : -1;
    const gesture = gestureFor(s, p.key);
    const elapsed = gesture.lastTurnMs > 0 ? now - gesture.lastTurnMs : Number.POSITIVE_INFINITY;
    let multiplier = 1;
    if (direction === gesture.direction) {
        if (elapsed <= 35) multiplier = 250;
        else if (elapsed <= 90) multiplier = 50;
        else if (elapsed <= 180) multiplier = 10;
    }
    gesture.lastTurnMs = now;
    gesture.direction = direction;
    /* Scale a UNIT step, not `delta`. The host already accumulates detents and
     * flushes one CC per tick, so `delta` is itself a count — multiplying it
     * would compound twice and a single flick would cross the whole range. */
    return direction * multiplier;
}

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
    if (s.moduleConfig?.enumSetIndex) return true;   // DSP writes by index, reads by name
    if (s.enumFmt[gi] === undefined) {
        s.enumFmt[gi] = enumUsesIndex(p.options, s.port.getParam(s.componentKey + ':' + ioKey));
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
    if (p.type === 'int') {
        const n = Math.round(v);
        return (p.signed && n > 0 ? '+' : '') + n;
    }
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
/* Effective automatability: a padScoped module can only declare concrete keys
 * for pads 1..automatablePads (chain 256-param cap), so a param on a later pad
 * has no host automation target and must not be offered. */
export function paramAutomatable(s: ModelState, p: KnobParam): boolean {
    if (!p.automatable) return false;
    const drum = s.moduleConfig?.drum;
    if (drum?.padScoping && drum.automatablePads && s.drumCurrentPad > drum.automatablePads) return false;
    /* padKeys: an alias with no key on the focused pad has no target to offer,
     * so no automation dot appears for a knob that does nothing. Gated on
     * padKeys — this runs per knob per frame, and a template always resolves. */
    if (drum?.padScoping?.padKeys && p.key.startsWith(drum.padScoping.aliasPrefix)
        && paramIoKey(s, p) === p.key) return false;
    return true;
}

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
        min: p.min, max: p.max, type: p.type, automatable: paramAutomatable(s, p),
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
    if (applyTriggerDelta(s, gi, p, ioKey, delta, () => enumFmtFor(s, gi, p, ioKey))) return;
    if (s.knobValues[gi] === null || s.knobValues[gi] === undefined) {
        const raw = s.port.getParam(s.componentKey + ':' + ioKey);
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

    /* Several clicks per step for a narrow range. Returning early on a turn that
     * has not yet crossed a step is deliberate: no set_param, and no undo entry
     * for an edit that changed nothing. */
    const div = detentsPerStep(p);
    let steps = delta;
    if (div > 1) {
        steps = countDetents(s.detentAccum, gi, delta, div);
        if (steps === 0) return;
    }

    // Enums are exempt (fixed detents-per-step); see knob-step.ts for the rest.
    const scaled = p.type === 'enum' ? delta / ENUM_DELTA_DIV
        : p.knobAcceleration === 'wide' ? wideStepCount(s, p, delta) * p.step
        : steps * perDetentStep(p);
    /* Snapshot the outgoing value in the same encoding the write uses, so the
     * inverse is byte-identical to what the DSP last received. */
    const prevNum = s.knobValues[gi] as number;
    /* A 2-state switch flips on ONE detent, in the direction turned.
     *
     * Without this it inherits the enum's fractional accumulator (delta/4 into
     * a value clamped to [min,max], read back with Math.round), which on a
     * boolean costs 2 detents to turn on and 3 to turn back off: from 0 the
     * steps are .25 (rounds off) then .5 (rounds ON), while from 1 they are
     * .75 and .5 (both still ON) before .25 finally reads off. That asymmetry
     * contradicts the picture — we draw these as a switch precisely because
     * the control has two states and no travel, so the knob should seat at the
     * end you turned toward, immediately and idempotently. */
    let newVal = isToggleParam(p) ? (delta > 0 ? p.max : p.min)
                                  : prevNum + scaled;
    newVal = Math.max(p.min, Math.min(p.max, newVal));
    if (p.type === 'int') newVal = Math.round(newVal);
    // enum: store as float for fractional accumulation; read sites use Math.round
    s.knobValues[gi] = newVal;

    const encode = (v: number) => p.type === 'enum'
        ? enumSetValue(p.options, Math.round(v), enumFmtFor(s, gi, p, ioKey))
        : (p.type === 'float') ? v.toFixed(4) : String(Math.round(v));
    const valStr = encode(newVal);
    const prevStr = encode(prevNum);
    mlog('set slot=' + s.port.track.index + ' gi=' + gi + ' key=' + s.componentKey + ':' + ioKey + ' val=' + valStr);
    /* One undo per knob GESTURE, not per detent: re-entering with the same key
     * coalesces the whole turn, and `prevStr` is the value before this detent —
     * group.ts keeps the FIRST old it is given, so undo returns to where the
     * gesture started. */
    beginGesture('knob:' + s.port.track.index + ':' + s.componentKey + ':' + ioKey,
        (p.label || p.key).toUpperCase(), 'T' + (s.port.track.index + 1), false);
    /* A param that rewrites the others has a lossy inverse — writing the old
     * value back re-applies that selection's defaults and loses the tweaks made
     * since — so snapshot the whole module instead. Presets imply the flag; a
     * bank/ROM/plugin selector sets it in the module config. See
     * KnobSlot.capturesModuleState for the cost. Once per gesture: addStateOp
     * keeps the first. */
    if (p.capturesModuleState) recordPresetState(s.port.track.index, s.componentKey);
    const ok = p.key.startsWith('test_') ? true
        : setChainParam(s.port, s.componentKey + ':' + ioKey, valStr, prevStr);
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
        if (ioKey === p.key) {
            if (!p.key.startsWith(ps.aliasPrefix)) continue;   // not pad-scoped
            /* A padKeys alias with no key on this pad. Clear rather than read:
             * the key cannot exist, so the IPC would be wasted, and keeping the
             * previous pad's number would show a value this voice hasn't got. */
            s.knobValues[i] = null;
            if (p.type === 'file') s.fileValues[i] = null;
            continue;
        }
        const raw = s.port.getParam(s.componentKey + ':' + ioKey);
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

/* Keep the displayed values converging on the engine's, at a cost the tick
 * period can afford — the period IS movy's MIDI sampling interval, so every
 * millisecond spent here is pad latency (docs/pad-to-sound-latency.md §1).
 *
 * Two shapes, because the two ports cost completely different things:
 *
 * - A **host slot** read is cheap and served from schwung's own cache, so it
 *   stays one read per tick, alternating between the visible page and a sweep
 *   of the whole array. Without the page cursor a param's displayed value lags
 *   by knobParams.length ticks, which on a 25-page module is seconds; with it,
 *   what the user is looking at converges in ~16 ticks while off-page values
 *   still creep forward for the next page switch.
 *
 * - A **movy chain** read is a blocking engine round trip, ~2.3 ms — measured
 *   at 2.4 ms of every ~9 ms tick, an 8× tax on the same information
 *   (docs/track-performance.md §6). So it takes the whole page plus a sweep
 *   window in ONE bulk round trip, once every REFRESH_BULK_TICKS. Same round
 *   trip whatever the batch, so the page now converges in 8 ticks rather than
 *   16 while costing an eighth of the IPC.
 */
export function refreshOneParam(s: ModelState, tickCount: number): void {
    if (s.knobParams.length === 0) return;
    if (tickCount - s.lastDeltaTick < REFRESH_SUPPRESS_TICKS) return;

    if (s.port.bulkReads) {
        if (--s.bulkCountdown > 0) return;
        s.bulkCountdown = REFRESH_BULK_TICKS;
        const batch: number[] = [];
        const base = s.knobPage * KNOBS_PER_PAGE;
        for (let k = 0; k < KNOBS_PER_PAGE; k++) batch.push(base + k);
        /* The sweep continues past the page so a page switch does not land on
         * stale values. Bounded to one page's worth per trip: the shim's bulk
         * handler calls get_param for every key ON THE AUDIO THREAD, so the
         * batch is kept far below its 64-item cap. */
        for (let k = 0; k < KNOBS_PER_PAGE; k++) {
            const i = s.refreshParamCursor % s.knobParams.length;
            s.refreshParamCursor = (i + 1) % s.knobParams.length;
            batch.push(i);
        }
        refreshBatch(s, batch);
        return;
    }

    if (tickCount % 2 === 0) {
        const local = s.refreshPageCursor % KNOBS_PER_PAGE;
        s.refreshPageCursor = (local + 1) % KNOBS_PER_PAGE;
        refreshAt(s, s.knobPage * KNOBS_PER_PAGE + local);
        return;
    }
    const i = s.refreshParamCursor % s.knobParams.length;
    s.refreshParamCursor = (i + 1) % s.knobParams.length;
    refreshAt(s, i);
}

/* Re-read one param by its I/O key. Undo writes chain params behind the model's
 * back (it restores the DSP directly), so without this the on-screen knob keeps
 * showing the pre-undo value until the round-robin refresh happens to reach it
 * — which on a large module is seconds later, and looks like undo did nothing. */
export function refreshParamKey(s: ModelState, ioKey: string): boolean {
    for (let i = 0; i < s.knobParams.length; i++) {
        const p = s.knobParams[i];
        if (p && paramIoKey(s, p) === ioKey) { refreshAt(s, i); return true; }
    }
    return false;
}

/* Is this index worth a read at all?
 *
 * Automation lanes / LFO-modulated params are engine-driven; reading them back
 * would overwrite the UI-owned base and repaint every tick. Show base.
 *
 * The base has to EXIST first, though. It starts null and only a knob turn ever
 * filled it, so a param automated (or LFO-targeted) before it was first touched
 * had no value at all: its cell read "...", its arc sat pinned at minimum — on
 * an octave -3..3 that looks like a real -3 — and knobParamInfo handed
 * automation p.min as the base. So seed it once, then stop reading. A lane
 * already playing means that one read lands on whatever the engine is driving
 * rather than a pristine base, which is still far closer than the bottom of the
 * range. */
function wantsRefresh(s: ModelState, i: number, ioKey: string): boolean {
    const p = s.knobParams[i];
    if (!p) return false;
    if (!s.noRefreshKeys.has(ioKey) && !s.modulatedKeys.has(ioKey)) return true;
    return p.type !== 'file'
        && (s.knobValues[i] === null || s.knobValues[i] === undefined);
}

/* Fold one raw read into the model. Split from the read itself so a batched
 * read applies through exactly the same rules as a single one. */
function applyRefreshed(s: ModelState, i: number, raw: string | null): void {
    const p = s.knobParams[i];
    if (!p) return;

    if (p.type === 'file') {
        if (raw !== s.fileValues[i]) {
            s.fileValues[i] = raw;
            s.dirty = true;
        }
        return;
    }

    if (raw === null) return;
    /* A selector reports the module's own index, which a sparse list makes
     * different from the on-screen position (items-param.ts). */
    if (isItemSelector(p)) {
        const pos = itemPositionOf(p, raw);
        if (pos !== null && pos !== s.knobValues[i]) { s.knobValues[i] = pos; s.dirty = true; }
        return;
    }
    maybeInferMeta(p, raw);
    if (p.type === 'enum') {
        s.enumFmt[i] = enumUsesIndex(p.options, raw);
        const idx = enumRawToIndex(p.options, raw);
        /* A trigger's badge is driven by the gesture state machine, never by the
         * DSP's value — so seed the latch from the first read, then leave the
         * value pinned. Letting it follow the read-back would also light the knob
         * LED permanently (normalizedValue 1.0) on a module that self-latches. */
        if (p.behavior === 'trigger') { seedTriggerState(s, p, idx); return; }
        if (idx !== s.knobValues[i]) { s.knobValues[i] = idx; s.dirty = true; }
        return;
    }
    const newVal = parseFloat(raw);
    if (!isNaN(newVal) && newVal !== s.knobValues[i]) {
        s.knobValues[i] = newVal;
        s.dirty = true;
    }
}

function refreshAt(s: ModelState, i: number): void {
    const p = s.knobParams[i];
    if (!p) return;
    const ioKey = paramIoKey(s, p);
    if (!wantsRefresh(s, i, ioKey)) return;
    applyRefreshed(s, i, s.port.getParam(s.componentKey + ':' + ioKey));
}

/* Read a set of indices in ONE port round trip. Only worth it where a read is
 * expensive — see refreshValues(). Duplicates are dropped rather than asked
 * twice: the page window and the sweep window overlap whenever the sweep passes
 * the current page. */
function refreshBatch(s: ModelState, indices: number[]): void {
    const want: number[] = [];
    const keys: string[] = [];
    for (const i of indices) {
        const p = s.knobParams[i];
        if (!p || want.indexOf(i) >= 0) continue;
        const ioKey = paramIoKey(s, p);
        if (!wantsRefresh(s, i, ioKey)) continue;
        want.push(i);
        keys.push(s.componentKey + ':' + ioKey);
    }
    if (keys.length === 0) return;
    const raw = s.port.getMany(keys);
    for (let n = 0; n < want.length; n++) applyRefreshed(s, want[n], raw[n] ?? null);
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
    if (!s.componentKey.startsWith('master_fx')) {
        for (let i = 1; i <= 2; i++) {
            if (s.port.getParam('lfo' + i + ':target') === s.componentKey) {
                const tp = s.port.getParam('lfo' + i + ':target_param');
                if (tp) s.modulatedKeys.add(tp);
            }
        }
    }
    if (s.modulatedKeys.size !== prev) s.dirty = true;
}
