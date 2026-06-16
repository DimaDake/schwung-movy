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
import { seqCmd } from './engine.js';
import { seqState } from './state.js';
import { seqToast } from './render.js';
import { beginStepAutomation } from './step-edit.js';

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

export function automationRegistry(): (LaneEntry | null)[][] { return registry; }

export function resetAutomation(): void {
    for (const t of registry) t.fill(null);
    liveVal.clear();
    liveCtx.clear();
    recordingLanes.clear();
    touchedNotTurned.clear();
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
    const tp = info.target + ':' + info.key;
    const existing = laneForParam(track, tp);
    if (existing >= 0) return existing;
    const lane = registry[track].findIndex((e) => e === null);
    if (lane < 0) return -1; // pool full
    if (!setMapping(lane)) return -1;
    registry[track][lane] = { targetParam: tp, shortName: info.key, min: info.min, max: info.max, type: info.type };
    seqCmd('alabel ' + track + ' ' + lane + ' ' + tp);
    seqCmd('abase ' + track + ' ' + lane + ' ' + norm7(info.value, info.min, info.max));
    return lane;
}

export function clearLane(track: number, lane: number): void {
    if (lane < 0 || lane >= 8) return;
    registry[track][lane] = null;
    liveVal.delete(track + ':' + lane);
    liveCtx.delete(track + ':' + lane);
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

/* Lanes (track*8+lane) currently being live-recorded — used to revert the
 * synth to base when the knob is released. */
const recordingLanes = new Set<number>();

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
    const tp = info.target + ':' + info.key;
    let lane = laneForParam(track, tp);
    if (lane < 0) lane = assignLane(track, track, info, setMapping);
    if (lane < 0) { seqState.autoPoolFull = true; return true; } // consumed; toast in render

    const step = held ? seqState.holdStep : seqState.curStep;
    const ctx = (held ? 'h' : 'r') + step;
    const seed = seqState.heldLocks.get(lane) ?? norm7(info.value, info.min, info.max);
    const next = accumLive(track, lane, ctx, seed, delta);
    seqCmd('aset ' + track + ' ' + lane + ' ' + step + ' ' + next);
    seqState.heldLocks.set(lane, next);          // optimistic held-step display
    if (recArmed) recordingLanes.add(track * 8 + lane);
    return true;
}

/* Knob released. In step-automation mode, a tap (touched, never turned) clears
 * this step's automation for the param. Otherwise: revert a live-recorded lane
 * to base, or sync the engine base for a normal edit. `info.value` is the
 * param's current (base) value. */
export function automationKnobReleased(track: number, physK: number, info: KnobParamInfo): void {
    const lane = laneForParam(track, info.target + ':' + info.key);
    const wasTap = touchedNotTurned.delete(physK);

    // Tap in step-automation mode → clear this step's lock (revert to base).
    if (seqState.stepAutoMode && wasTap) {
        if (lane >= 0 && seqState.heldLocks.has(lane)) {
            seqCmd('aclrs ' + track + ' ' + lane + ' ' + seqState.holdStep);
            seqState.heldLocks.delete(lane);             // optimistic: back to name
            liveCtx.delete(track + ':' + lane);          // reseed next edit
            seqToast(info.key + ' cleared');
        }
        return;
    }

    if (lane < 0) return;
    const baseN = norm7(info.value, info.min, info.max);
    if (recordingLanes.delete(track * 8 + lane)) {
        seqCmd('abase ' + track + ' ' + lane + ' ' + baseN); // emits → revert to base
    } else if (!seqState.stepAutoMode) {
        seqCmd('abaseq ' + track + ' ' + lane + ' ' + baseN); // quiet base sync
    }
}

/* Clear ALL lanes' automation at one step (Clear + step, or step + Clear). */
export function clearStepAllAutomation(track: number, step: number): void {
    seqCmd('aclrstep ' + track + ' ' + step);
    if (seqState.stepAutoMode && seqState.holdStep === step) seqState.heldLocks.clear();
}

/* Hold-Clear + knob touch: clear the lane bound to this knob's param. */
export function clearLaneForKnob(track: number, info: KnobParamInfo): void {
    const lane = laneForParam(track, info.target + ':' + info.key);
    if (lane >= 0) clearLane(track, lane);
}

/* Rebuild the registry from the engine's `alabels` and re-apply each assigned
 * lane's chain mapping. `apply(slot, lane, targetParam)` issues knob_<N>_set;
 * `rangeOf(targetParam)` supplies min/max/type for denormalization. */
export function syncLabelsFromEngine(
    alabels: string,
    apply: (slot: number, lane: number, targetParam: string) => void,
    rangeOf: (targetParam: string) => { min: number; max: number; type: string } | null,
): void {
    const tracks = alabels.split(',');
    for (let t = 0; t < 4 && t < tracks.length; t++) {
        const lanes = tracks[t].split('.');
        for (let l = 0; l < 8 && l < lanes.length; l++) {
            const tp = lanes[l];
            if (!tp || tp === '-') { registry[t][l] = null; continue; }
            const r = rangeOf(tp);
            registry[t][l] = {
                targetParam: tp, shortName: tp.split(':')[1] ?? tp,
                min: r?.min ?? 0, max: r?.max ?? 1, type: r?.type ?? 'float',
            };
            apply(t, l, tp);
        }
    }
}

/* Best-effort range lookup for a "target:param" from a slot's chain_params. */
export function rangeFromChainParams(slot: number, targetParam: string): { min: number; max: number; type: string } | null {
    const colon = targetParam.indexOf(':');
    if (colon < 0) return null;
    const target = targetParam.slice(0, colon);
    const key = targetParam.slice(colon + 1);
    const cp = shadow_get_param(slot, target + ':chain_params');
    if (!cp) return null;
    try {
        const params = JSON.parse(cp) as Array<{ key: string; type: string; min?: number; max?: number }>;
        const p = params.find((x) => x.key === key);
        if (!p) return null;
        return { min: p.min ?? 0, max: p.max ?? 1, type: p.type };
    } catch { return null; }
}
