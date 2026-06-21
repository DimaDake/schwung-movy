/* UI-side automation registry: maps each track's 8 lanes to a chain param
 * (target:param) and caches its range for rendering/denormalization. The engine
 * owns lock data + playback; this layer assigns lanes (a pool of 8 per track,
 * mirroring the chain's knob mappings) and feeds the engine commands.
 *
 * Live value accumulation: knob turns arrive as many small deltas, faster than
 * the ~24 Hz status poll, so we can't reseed from `heldLocks` each turn. We keep
 * a per-(track,lane) live 0..127 accumulator, reseeded only when the edit
 * context changes (held step vs. base), and emit the engine command from it. */
import type { KnobParamInfo } from '../model/store.js';
import { seqCmd, requestLabelSync } from './engine.js';
import { seqState } from './state.js';
import { seqToast } from './render.js';
import { beginStepAutomation, heldRange } from './step-edit.js';
import { aliasFromConcrete, type PadScoping } from '../model/pad-scope.js';

export interface LaneEntry {
    targetParam: string;   // "synth:cutoff"
    shortName: string;     // param key for display
    min: number;
    max: number;
    type: string;
}

/* registry[track][lane] = entry | null */
const registry: (LaneEntry | null)[][] =
    [0, 1, 2, 3].map(() => new Array<LaneEntry | null>(8).fill(null));

/* Live accumulators, keyed "track:lane" → current 0..127 value, plus the edit
 * context they were seeded for ("h<step>" or "b"). */
const liveVal = new Map<string, number>();
const liveCtx = new Map<string, string>();

/* Knobs being turned RIGHT NOW during a live take ("track:lane" → 0..127), so
 * the on-screen knob follows the turn. Cleared on release so the knob snaps
 * back to base — the param page stays decoupled from playback read-back. */
const liveTurn = new Map<string, number>();

/* Live-turn values for `track`, lane → 0..127 (denormalized in app/tick). */
export function liveTurnValues(track: number): Map<number, number> {
    const out = new Map<number, number>();
    for (const [k, v] of liveTurn) {
        const [t, l] = k.split(':');
        if (+t === track) out.set(+l, v);
    }
    return out;
}

export function automationRegistry(): (LaneEntry | null)[][] { return registry; }

export function resetAutomation(): void {
    for (const t of registry) t.fill(null);
    liveVal.clear();
    liveCtx.clear();
    liveTurn.clear();
    touchedNotTurned.clear();
    lastDisplaySig = '';
}

/* The automation value display (inverted value + moved arc instead of the param
 * name) is fed out-of-band of the param page's normal dirty path. A knob turn
 * consumed as automation never reaches the model, and the page is decoupled from
 * playback read-back for perf, so nothing else repaints it. Two sources drive it:
 *   - held step: `stepAutoMode` + `heldLocks` (rewritten by the status poll), and
 *   - live record: `liveTurn` (set per turn, cleared on release → snap to base).
 * This signature lets the app tick detect either changing and force a repaint —
 * without repainting on every idle/playback tick. */
let lastDisplaySig = '';
function displaySig(): string {
    let sig = '';
    if (seqState.stepAutoMode) {
        sig = 's';
        const lanes = [...seqState.heldLocks.entries()].sort((a, b) => a[0] - b[0]);
        for (const [l, v] of lanes) sig += l + ':' + v + '.';
    }
    // Live-record turns also move the on-screen arc/value; fold them in so a
    // turn (and the release that clears them) repaints the param page.
    const live = [...liveTurn.entries()].sort();
    for (const [k, v] of live) sig += '|' + k + '=' + v;
    return sig;
}
/* True when the held-step display changed since the previous call (call once
 * per tick). */
export function automationDisplayDirty(): boolean {
    const sig = displaySig();
    if (sig === lastDisplaySig) return false;
    lastDisplaySig = sig;
    return true;
}

/* 7-bit conversion matching the chain's abs-CC scaling. */
export function norm7(v: number, min: number, max: number): number {
    if (max <= min) return 0;
    return Math.max(0, Math.min(127, Math.round((v - min) / (max - min) * 127)));
}
export function denorm7(n: number, min: number, max: number): number {
    return min + (n / 127) * (max - min);
}

function clamp7(n: number): number { return Math.max(0, Math.min(127, n)); }

/* Param keys assigned to a lane on `track` (for the page's read-back suppression). */
export function laneKeysForTrack(track: number): string[] {
    const out: string[] = [];
    for (const e of registry[track]) if (e) out.push(e.shortName);
    return out;
}

/* All 8 lanes assigned? Derived live from the registry so the "pool full" state
 * (which hides non-assigned params on a step-hold) flips the instant the 8th
 * lane is assigned and clears the instant a lane is freed — unlike a sticky flag. */
export function poolIsFull(track: number): boolean {
    return registry[track].every((e) => e !== null);
}

export function laneForParam(track: number, targetParam: string): number {
    const lanes = registry[track];
    for (let l = 0; l < 8; l++) if (lanes[l]?.targetParam === targetParam) return l;
    return -1;
}

/* Assign `info`'s param to a free lane on `track`. `setMapping(lane)` issues the
 * chain knob_<lane+1>_set (returns false on failure). Returns the lane, or -1 if
 * the pool of 8 is full / mapping failed. Seeds the engine label + base. */
export function assignLane(
    track: number, slot: number, info: KnobParamInfo,
    setMapping: (lane: number) => boolean,
): number {
    const tp = info.target + ':' + info.ioKey;
    const existing = laneForParam(track, tp);
    if (existing >= 0) return existing;
    const lane = registry[track].findIndex((e) => e === null);
    if (lane < 0) return -1; // pool full
    if (!setMapping(lane)) return -1;
    registry[track][lane] = { targetParam: tp, shortName: info.ioKey, min: info.min, max: info.max, type: info.type };
    seqCmd('alabel ' + track + ' ' + lane + ' ' + tp);
    seqCmd('abase ' + track + ' ' + lane + ' ' + norm7(info.value, info.min, info.max));
    return lane;
}

export function clearLane(track: number, lane: number): void {
    if (lane < 0 || lane >= 8) return;
    registry[track][lane] = null;
    liveVal.delete(track + ':' + lane);
    liveCtx.delete(track + ':' + lane);
    liveTurn.delete(track + ':' + lane);
    seqCmd('aclr ' + track + ' ' + lane);
}

/* Seed/accumulate the live value for (track, lane) in the given context. */
function accumLive(track: number, lane: number, ctx: string, seed: number, delta: number): number {
    const k = track + ':' + lane;
    if (liveCtx.get(k) !== ctx) {
        liveVal.set(k, seed);
        liveCtx.set(k, ctx);
    }
    const next = clamp7((liveVal.get(k) ?? seed) + delta);
    liveVal.set(k, next);
    return next;
}

/* Knobs (physK) touched in step-automation mode that haven't been turned yet —
 * releasing one (a tap) clears that step's automation for the param. */
const touchedNotTurned = new Set<number>();

/* Knob touched: in step-automation mode, arm tap-to-clear for this knob. */
export function automationKnobTouched(physK: number): void {
    if (seqState.stepAutoMode) touchedNotTurned.add(physK);
}

/* Route a knob turn as automation. Returns true if consumed (step-automation
 * or live-record). In normal mode it returns false so the normal param path
 * edits the original/base value immediately (no engine round-trip → no lag);
 * the engine's base is synced on knob release (`automationKnobReleased`). */
export function handleAutomationKnob(
    track: number, physK: number, info: KnobParamInfo, delta: number,
    setMapping: (lane: number) => boolean,
): boolean {
    if (!info.automatable) return false;
    const recArmed = seqState.recording && seqState.playing;
    // Turning a knob while a single step is held enters step-automation mode.
    if (!seqState.stepAutoMode && !recArmed && beginStepAutomation() < 0) {
        return false; // no step held → normal path owns the base (immediate)
    }
    const held = seqState.stepAutoMode;
    if (!held && !recArmed) return false;
    touchedNotTurned.delete(physK); // a turn → not a tap (no clear on release)

    // Step-automation or Rec: ensure a lane, then write a lock at the target step.
    const tp = info.target + ':' + info.ioKey;
    let lane = laneForParam(track, tp);
    if (lane < 0) lane = assignLane(track, track, info, setMapping);
    if (lane < 0) return true; // consumed; pool-full state (poolIsFull) drives the toast

    const step = held ? seqState.holdStep : seqState.curStep;
    // A held step keys the accumulator by its (fixed) step. A live take must
    // accumulate CONTINUOUSLY as the playhead advances, so it keys by lane only
    // ('r', step-independent) — otherwise every step boundary reseeds it. The
    // seed is read only on the first turn of a context; for live that is the
    // current base (heldLocks is held-step-only and the status poll clears it
    // each tick, so it must NOT drive the live seed — that caused the value to
    // snap back to base on every turn).
    const ctx = held ? 'h' + step : 'r';
    const seed = held
        ? (seqState.heldLocks.get(lane) ?? norm7(info.value, info.min, info.max))
        : norm7(info.value, info.min, info.max);
    const next = accumLive(track, lane, ctx, seed, delta);
    // Holding a bar in Loop mode writes the value across the whole bar.
    const r = held ? heldRange() : null;
    if (r && r.s1 > r.s0) {
        seqCmd('asetr ' + track + ' ' + lane + ' ' + r.s0 + ' ' + r.s1 + ' ' + next);
    } else {
        seqCmd('aset ' + track + ' ' + lane + ' ' + step + ' ' + next);
    }
    if (held) seqState.heldLocks.set(lane, next); // optimistic held-step display
    // Live take (no step held): let the on-screen knob follow the turn. The
    // held-step case is already driven by heldLocks above.
    if (!held) liveTurn.set(track + ':' + lane, next);
    return true;
}

/* Knob released. In step-automation mode, a tap (touched, never turned) clears
 * this step's automation for the param. Otherwise: revert a live-recorded lane
 * to base, or sync the engine base for a normal edit. `info.value` is the
 * param's current (base) value. */
export function automationKnobReleased(track: number, physK: number, info: KnobParamInfo): void {
    const lane = laneForParam(track, info.target + ':' + info.ioKey);
    const wasTap = touchedNotTurned.delete(physK);
    if (lane >= 0) {
        liveTurn.delete(track + ':' + lane); // knob released → snap to base
        // End the live accumulator's context so the NEXT take reseeds from the
        // (possibly updated) base instead of continuing this take's value.
        liveCtx.delete(track + ':' + lane);
        liveVal.delete(track + ':' + lane);
    }

    // Tap in step-automation mode → clear this step's lock (revert to base).
    if (seqState.stepAutoMode && wasTap) {
        if (lane >= 0 && seqState.heldLocks.has(lane)) {
            seqCmd('aclrs ' + track + ' ' + lane + ' ' + seqState.holdStep);
            seqState.heldLocks.delete(lane);             // optimistic: back to name
            liveCtx.delete(track + ':' + lane);          // reseed next edit
            requestLabelSync();                          // engine may free the lane (last lock)
            seqToast(info.key + ' cleared');
        }
        return;
    }

    if (lane < 0) return;
    // Live-recorded automation latches until its end trigger (next note on a
    // different step, or next lock) — no revert-to-base on release. Only a
    // normal (non-automation) edit syncs the engine base, quietly.
    if (!seqState.stepAutoMode) {
        seqCmd('abaseq ' + track + ' ' + lane + ' ' + norm7(info.value, info.min, info.max));
    }
}

/* Clear ALL lanes' automation at one step (Clear + step, or step + Clear). */
export function clearStepAllAutomation(track: number, step: number): void {
    seqCmd('aclrstep ' + track + ' ' + step);
    requestLabelSync(); // a lane left lock-less is freed by the engine → re-sync
    if (seqState.stepAutoMode && seqState.holdStep === step) seqState.heldLocks.clear();
}

/* Hold-Clear + knob touch: clear the lane bound to this knob's param. */
export function clearLaneForKnob(track: number, info: KnobParamInfo): void {
    const lane = laneForParam(track, info.target + ':' + info.ioKey);
    if (lane >= 0) clearLane(track, lane);
}

export type LaneRange = { min: number; max: number; type: string };
/* `drop` = purge the persisted lane (stale param / obsolete alias key);
 * `unknown` = chain not loaded yet, keep the lane untouched this pass. */
export type LaneVerdict = LaneRange | 'drop' | 'unknown';

/* Decide a persisted lane's fate against the module's current param set. `ps` is
 * the track's drum pad scoping (null on a non-drum track); `paramRange(key)`
 * returns the range of a known param or null if the module has no such param
 * (sourced from the loaded model, which is authoritative for config-driven drum
 * modules where chain_params is absent). Rules:
 *   - a BARE alias key (`pad_pan`) is a pre-per-pad-migration leftover the
 *     concrete-key routing can never match again → drop;
 *   - a CONCRETE pad key (`p07_pan`) is validated by its alias (`pad_pan`),
 *     since the param set lists only the alias, never the concrete key;
 *   - otherwise the key itself must be a known param;
 *   - known → keep (its range); unknown → stale (drop).
 * The caller returns `unknown` (keep) when the module isn't loaded yet, so this
 * only ever runs against an authoritative param set. */
export function validateLane(
    tp: string, ps: PadScoping | null,
    paramRange: (key: string) => LaneRange | null,
): LaneRange | 'drop' {
    const key = tp.slice(tp.indexOf(':') + 1);
    if (ps && key.startsWith(ps.aliasPrefix)) return 'drop'; // bare alias (obsolete)
    const lookup = (ps && aliasFromConcrete(ps, key)) || key;
    return paramRange(lookup) ?? 'drop';
}

/* Rebuild the registry from the engine's `alabels` and re-apply each assigned
 * lane's chain mapping. `apply(slot, lane, targetParam)` issues knob_<N>_set.
 * `validate(track, tp)` decides each lane's fate (see `validateLane`): a `drop`
 * verdict purges the lane (engine + persistence, via `clearLane` → `aclr`) so
 * stale/obsolete lanes can't permanently occupy the 8-lane pool. */
export function syncLabelsFromEngine(
    alabels: string,
    apply: (slot: number, lane: number, targetParam: string) => void,
    validate: (track: number, targetParam: string) => LaneVerdict,
): void {
    const tracks = alabels.split(',');
    for (let t = 0; t < 4 && t < tracks.length; t++) {
        const lanes = tracks[t].split('.');
        for (let l = 0; l < 8 && l < lanes.length; l++) {
            const tp = lanes[l];
            if (!tp || tp === '-') { registry[t][l] = null; continue; }
            const v = validate(t, tp);
            if (v === 'drop') { clearLane(t, l); continue; }
            const r: LaneRange = v === 'unknown' ? { min: 0, max: 1, type: 'float' } : v;
            registry[t][l] = {
                targetParam: tp, shortName: tp.split(':')[1] ?? tp,
                min: r.min, max: r.max, type: r.type,
            };
            apply(t, l, tp);
        }
    }
}
