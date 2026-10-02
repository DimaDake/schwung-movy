/* UI-side automation registry: maps each track's lanes to a chain param
 * (target:param) and caches its range for rendering/denormalization. The engine
 * owns lock data + playback; this layer assigns lanes (a pool of AUTO_LANES per
 * track), binds each to its param in the engine and feeds it commands.
 *
 * Live value accumulation: knob turns arrive as many small deltas, faster than
 * the ~24 Hz status poll, so we can't reseed from `heldLocks` each turn. We keep
 * a per-(track,lane) live 0..127 accumulator, reseeded only when the edit
 * context changes (held step vs. base), and emit the engine command from it. */
import { TRACK_COUNT } from '../track/ref.js';
import type { KnobParamInfo } from '../model/store.js';
import { endEdit } from '../undo/group.js';
import { beginGesture, undoableEdit } from '../undo/edit.js';
import { seqSideEffect } from '../undo/record.js';
import { seqCmd, requestLabelSync } from './engine.js';
import type { LaneBindInfo } from './lane-mapping.js';
import { AUTO_LANES } from './constants.js';
import { toLane7, stepLane7, type LaneShape } from './lane-value.js';
import { seqState } from './state.js';
import { seqToast } from './render.js';
import { beginStepAutomation, heldRange } from './step-edit.js';
import { noteLaneBase, clearLaneBase, resetLaneBases } from './automation-base.js';
import { aliasFromConcrete, type PadScoping } from '../model/pad-scope.js';

export interface LaneEntry extends LaneBindInfo {
    shortName: string;     // param key for display
}

/* registry[track][lane] = entry | null */
const registry: (LaneEntry | null)[][] =
    Array.from({ length: TRACK_COUNT }, () => new Array<LaneEntry | null>(AUTO_LANES).fill(null));

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
    resetLaneBases();
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

/* The 7-bit conversions live in lane-value.ts; re-exported for the callers
 * that have always found them here. */
export { norm7, denorm7 } from './lane-value.js';

/* Param keys assigned to a lane on `track` (for the page's read-back suppression). */
export function laneKeysForTrack(track: number): string[] {
    const out: string[] = [];
    for (const e of registry[track]) if (e) out.push(e.shortName);
    return out;
}

/* Every lane assigned? Derived live from the registry so the "pool full" state
 * (which hides non-assigned params on a step-hold) flips the instant the last
 * lane is assigned and clears the instant a lane is freed — unlike a sticky flag. */
export function poolIsFull(track: number): boolean {
    return registry[track].every((e) => e !== null);
}

export function laneForParam(track: number, targetParam: string): number {
    const lanes = registry[track];
    for (let l = 0; l < AUTO_LANES; l++) if (lanes[l]?.targetParam === targetParam) return l;
    return -1;
}

/* Assign `info`'s param to a free lane on `track`. `setMapping(lane)` binds the
 * lane to the param in the engine (returns false on failure). Returns the lane,
 * or -1 if the pool is full / the bind failed. Seeds the engine label + base. */
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
    registry[track][lane] = {
        targetParam: tp, shortName: info.ioKey, min: info.min, max: info.max, type: info.type,
        options: info.options, wiresNames: info.wiresNames,
    };
    seqCmd('alabel ' + track + ' ' + lane + ' ' + tp);
    seqCmd('abase ' + track + ' ' + lane + ' ' + toLane7(info.value, info));
    /* Beside the command, never derived later: this IS the base, in the
     * parameter's own units, and it is the last moment anything holds it —
     * from the next step onward the lane owns the value (SP-36). */
    noteLaneBase(track, lane, info.value);
    return lane;
}

/* `undoable` distinguishes the user asking for this from movy tidying up after
 * itself. A lane dropped because its module went away is a CONSEQUENCE of the
 * swap, not an edit of its own: giving it an entry put it on top of the swap's,
 * so Undo cleared a lane instead of restoring the module. The swap's own
 * snapshot already holds the lane state, so the cleanup needs no entry at all. */
export function clearLane(track: number, lane: number, undoable = true): void {
    if (lane < 0 || lane >= AUTO_LANES) return;
    const name = registry[track][lane]?.shortName;
    registry[track][lane] = null;
    clearLaneBase(track, lane);
    liveVal.delete(track + ':' + lane);
    liveCtx.delete(track + ':' + lane);
    liveTurn.delete(track + ':' + lane);
    const clear = () => seqCmd('aclr ' + track + ' ' + lane);
    if (!undoable) { seqSideEffect(clear); return; }
    undoableEdit('CLEAR LANE', 'T' + (track + 1), clear);
    /* Clear + knob-touch changes nothing else on screen but the lane mark, so
     * without this a working clear is indistinguishable from a missed touch. */
    if (name) seqToast(name + ' lane cleared');
}

/* Seed/accumulate the live value for (track, lane) in the given context. */
function accumLive(track: number, lane: number, ctx: string, seed: number, delta: number,
                   shape: LaneShape): number {
    const k = track + ':' + lane;
    if (liveCtx.get(k) !== ctx) {
        liveVal.set(k, seed);
        liveCtx.set(k, ctx);
    }
    const next = stepLane7(liveVal.get(k) ?? seed, delta, shape);
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
    /*
     * A HELD STEP CANNOT LOCK A PARAM THAT CANNOT TAKE A LANE, AND SAYS SO (SP-35).
     *
     * Through a hold the turn is not an edit — the hand is choosing what to lock
     * — so returning false is not neutral: `midi/router.ts` hands an unconsumed
     * turn to `owner.page.knobTurn` / `model.handleKnobDelta`, i.e. it rewrites
     * the PATCH under someone who believes they are taking a lock.
     *
     * The filter used to be `hiddenDuringHold` in movy's body drawer, which only
     * works while movy draws the body: under `page` the body is Schwung's, so the
     * offer was invisible until you turned it. The channel for saying it PER-CELL
     * on a delegated page is upstream (SU-8) and must not be invented here —
     * `decorations` carries `locked` ("a lane live on this frame holds this
     * PARAMETER") and marking a cell nobody locked is the lie SP-16 removed. This
     * toast is movy's own chrome, drawn after the body, so it survives `page`.
     *
     * THE GATE IS THE SAME ADMISSION TEST THE LOCK USES, and that is the point:
     * `seqState.stepAutoMode` alone is "already promoted", which `stepAutoTick`
     * only reaches after STEP_AUTO_MS (300 ms) — so a turn inside that window was
     * refused-but-not-consumed and edited the patch, which is the sentence above.
     * `heldRange() !== null` is the other half of the SAME admission test the
     * automatable path applies at `beginStepAutomation() < 0` below — one step
     * held, so a turn promotes — read without its side effects, so a refusal does
     * not promote. Neither half is `anyStepHeld()`: that is true for every hold
     * mode `hold` is reused for (a drum multi-press, a Loop-mode bar, step
     * record), and in those a turn is a legitimate edit. Two of them are already
     * unreachable here — the step page returns in `midi/router.ts` before this
     * function, and a multi-press makes `heldRange()` null — which is what makes
     * the term narrow enough to be the same claim and no wider.
     *
     * `recArmed` is excluded for the same reason the promotion below excludes it:
     * under live record a turn is a take, not an assign, and a non-automatable
     * param keeps its long-standing base edit there.
     */
    const recArmed = seqState.recording && seqState.playing;
    if (!info.automatable) {
        if (seqState.stepAutoMode || (!recArmed && heldRange() !== null)) {
            seqToast('NO LOCK: ' + info.ioKey);
            return true;
        }
        return false;
    }
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
        ? (seqState.heldLocks.get(lane) ?? toLane7(info.value, info))
        : toLane7(info.value, info);
    const next = accumLive(track, lane, ctx, seed, delta, info);
    // Holding a bar in Loop mode writes the value across the whole bar.
    const r = held ? heldRange() : null;
    /* One undo per automation gesture: the turn coalesces until the knob is
     * released (automationKnobReleased closes this key). */
    beginGesture('stepauto:' + track + ':' + tp, 'AUTOMATION', 'T' + (track + 1));
    /* A held-step lock is QUIET: the engine stores it without applying it, so
     * the parameter only moves when the step itself plays. A live take keeps
     * the audition — there the turn is what you are recording. */
    const quiet = held ? ' 1' : '';
    if (r && r.s1 > r.s0) {
        seqCmd('asetr ' + track + ' ' + lane + ' ' + r.s0 + ' ' + r.s1 + ' ' + next + quiet);
    } else {
        seqCmd('aset ' + track + ' ' + lane + ' ' + step + ' ' + next + quiet);
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
    /* The capacitive release is the real end of a knob gesture, so it is what
     * closes the undo group the turn opened (store.ts / step automation). The
     * idle timeout in group.ts only covers a release that never arrives. */
    endEdit('knob:' + track + ':' + info.target + ':' + info.ioKey);
    endEdit('stepauto:' + track + ':' + info.target + ':' + info.ioKey);
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
            undoableEdit('CLEAR AUTOMATION', 'T' + (track + 1),
                () => seqCmd('aclrs ' + track + ' ' + lane + ' ' + seqState.holdStep));
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
        seqCmd('abaseq ' + track + ' ' + lane + ' ' + toLane7(info.value, info));
        noteLaneBase(track, lane, info.value);
    }
}

/* Clear ALL lanes' automation at one step (Clear + step, or step + Clear). */
export function clearStepAllAutomation(track: number, step: number): void {
    undoableEdit('CLEAR AUTOMATION', 'T' + (track + 1),
        () => seqCmd('aclrstep ' + track + ' ' + step));
    requestLabelSync(); // a lane left lock-less is freed by the engine → re-sync
    if (seqState.stepAutoMode && seqState.holdStep === step) seqState.heldLocks.clear();
}

/* Hold-Clear + knob touch: clear the lane bound to this knob's param. */
export function clearLaneForKnob(track: number, info: KnobParamInfo): void {
    const lane = laneForParam(track, info.target + ':' + info.ioKey);
    if (lane >= 0) clearLane(track, lane);
}

export type LaneRange = { min: number; max: number; type: string; options?: string[]; wiresNames?: boolean };
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

/* Rebuild the registry from the engine's `alabels` and bind each assigned lane
 * in the engine. `apply(slot, lane, entry)` issues the bind. `validate(track,
 * tp)` decides each lane's fate (see `validateLane`): a `drop` verdict purges
 * the lane (engine + persistence, via `clearLane` → `aclr`) so stale/obsolete
 * lanes can't permanently occupy the pool.
 *
 * An `unknown` lane (its module not loaded yet) is kept but NOT bound: the bind
 * carries the param's range, and a guessed one would write wrong values. It
 * plays nothing until a later sync binds it, so the return value says one is
 * owed — true while any lane is still waiting for its module. */
export function syncLabelsFromEngine(
    alabels: string,
    apply: (slot: number, lane: number, entry: LaneEntry) => void,
    validate: (track: number, targetParam: string) => LaneVerdict,
): boolean {
    let pending = false;
    const tracks = alabels.split(',');
    /* Every track, not the first four. The engine emits labels for all of them
     * and always has; the cap here was a leftover from when movy had four
     * tracks, and it meant a lane on track 5-16 was never rebuilt after a Set
     * load — automation that played back in one session and was silently gone
     * in the next. */
    for (let t = 0; t < TRACK_COUNT && t < tracks.length; t++) {
        const lanes = tracks[t].split('.');
        for (let l = 0; l < AUTO_LANES && l < lanes.length; l++) {
            const tp = lanes[l];
            /* THE BASE BELONGS TO THE PARAMETER, NOT TO THE LANE NUMBER. A lane
             * that came back pointing somewhere else is a different parameter
             * on the same slot, and its predecessor's base would put the
             * pointer at a value this param never held (SP-36). A lane whose
             * target is unchanged keeps the base movy recorded in the
             * parameter's own units — the engine's `abases` seed below is the
             * same number after a 7-bit round trip, so re-seeding it would only
             * blur it. */
            if (registry[t][l]?.targetParam !== tp) clearLaneBase(t, l);
            if (!tp || tp === '-') { registry[t][l] = null; continue; }
            const v = validate(t, tp);
            if (v === 'drop') { clearLane(t, l, false); continue; }
            const r: LaneRange = v === 'unknown' ? { min: 0, max: 1, type: 'float' } : v;
            const e: LaneEntry = {
                targetParam: tp, shortName: tp.split(':')[1] ?? tp,
                min: r.min, max: r.max, type: r.type,
                options: r.options, wiresNames: r.wiresNames,
            };
            registry[t][l] = e;
            if (v === 'unknown') { pending = true; continue; }
            apply(t, l, e);
        }
    }
    return pending;
}
