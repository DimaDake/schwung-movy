import { mlog } from '../log.js';

/* Host IPC accounting.
 *
 * Every shadow_*_param call is a synchronous round-trip: the JS side parks in a
 * 200 us usleep loop until the shim services the mailbox on its next SPI frame,
 * so one call costs about one audio block (~3-4 ms on device) no matter how
 * trivial the value is. The tick rate is therefore set by the *number* of calls
 * per tick, not by any JS work — 14 calls is ~18 Hz, and the knob feels laggy
 * because the tick period is also the MIDI sampling interval.
 *
 * perf_refresh_ms only ever timed the one refreshOneParam() GET, which hid the
 * rest. This counts every call, grouped by a digit-stripped key, so a growing
 * per-tick call count is attributable to a call site instead of a guess. */

const SAMPLE_TICKS = 120;

type Bucket = { n: number; ms: number };

let counts: Record<string, Bucket> = {};
let ticks     = 0;
let callsTick = 0;
let maxCalls  = 0;
let installed = false;

/* 'knob_12_name' -> 'knob_N_name', 'synth:flt_decay' -> 'synth:*'. Keeps the
 * summary to a handful of lines whatever the module's param count is. */
function label(kind: string, key: unknown): string {
    const k = typeof key === 'string' ? key : String(key);
    const colon = k.indexOf(':');
    if (colon > 0) return kind + ' ' + k.slice(0, colon) + ':*';
    return kind + ' ' + k.replace(/[0-9]+/g, 'N');
}

/* Set to a label substring to log one stack trace per sample window for the
 * matching call — attributes a per-tick call to its actual caller. Off by
 * default; this is how `reconcileFeedbackHolds` was traced to schwung's own
 * shadow_ui.js rather than to movy. */
const TRACE_LABEL = '';
let tracedThisWindow = false;

function record(name: string, ms: number): void {
    const b = counts[name] ?? (counts[name] = { n: 0, ms: 0 });
    b.n++;
    b.ms += ms;
    callsTick++;
    if (TRACE_LABEL && !tracedThisWindow && name.indexOf(TRACE_LABEL) >= 0) {
        tracedThisWindow = true;
        const st = new Error().stack ?? '(no stack)';
        mlog('perf_who ' + name + ' <- ' + st.replace(/\n/g, ' | ').slice(0, 400));
    }
}

type HostFn = (...a: unknown[]) => unknown;
type Wrapper = HostFn & { _movyProbe?: boolean; _movyOrig?: HostFn };

/* Where a wrapper sends what it measured.
 *
 * It has to be looked up on the GLOBAL at call time, not captured in the
 * wrapper's closure. A tool open re-evaluates ui.js — fresh module state, same
 * host globals — so a closure-captured `record` keeps filling the counters of an
 * evaluation that will never report again, and `shadow_ui` outlives even a Move
 * stack restart, so nothing clears it. That is not hypothetical: the batched
 * chain refresh ran 122 times in eight seconds on device and perf_ipc showed no
 * bulk reads at all. Every evaluation claims the sink; the newest one wins. */
const SINK = '__movyPerfSink';
function sink(name: string, ms: number): void {
    const f = (globalThis as Record<string, unknown>)[SINK];
    if (typeof f === 'function') (f as (n: string, m: number) => void)(name, ms);
}

function wrap(fnName: string, kind: string, keyArg: number): void {
    const g = globalThis as Record<string, unknown>;
    const cur = g[fnName] as Wrapper | undefined;
    if (typeof cur !== 'function') return;
    /* Re-opening the tool re-evaluates ui.js — module state resets, but the host
     * globals persist and still hold the PREVIOUS evaluation's wrapper, whose
     * closure records into counters nothing reports any more. Skipping there (as
     * this did) leaves the call permanently unaccounted: the batched chain
     * refresh ran ~117 times in six seconds on device and `perf_ipc` showed no
     * bulk reads at all. Re-wrap the original instead — keeping `_movyOrig` is
     * what makes that possible without nesting wrapper inside wrapper and
     * counting every call twice. */
    /* `_movyOrig` is missing only on a wrapper left by a build that predates it.
     * There is no way back to the original then, so wrap the stale wrapper —
     * once. It still records, but into the counters of an evaluation that never
     * reports again, so nothing is double-counted; without this the call stays
     * invisible until shadow_ui itself dies, and it survives a Move stack
     * restart. Every wrapper written since carries `_movyOrig`, so this can
     * happen at most once in a process. */
    const fn = (cur._movyProbe ? cur._movyOrig ?? cur : cur) as HostFn;
    const wrapped = function (...args: unknown[]): unknown {
        const t0 = Date.now();
        const r  = fn.apply(null, args);
        sink(label(kind, args[keyArg]), Date.now() - t0);
        return r;
    } as Wrapper;
    wrapped._movyProbe = true;
    wrapped._movyOrig  = fn;
    g[fnName] = wrapped;
}

/* A tool open re-evaluates ui.js, so `installed` starts false again there. Tests
 * run in one module instance (the browser build shares a chunk, so re-importing
 * does not re-evaluate), and this is how they reach the same starting state. */
export function resetPerfProbeInstall(): void {
    installed = false;
}

export function installPerfProbe(): void {
    /* Claimed unconditionally, before the `installed` guard: taking over the
     * sink is how THIS evaluation starts owning the counts of wrappers a
     * previous one installed. */
    (globalThis as Record<string, unknown>)[SINK] = record;
    if (installed) return;
    installed = true;
    wrap('shadow_get_param',      'get',  1);
    wrap('shadow_set_param',      'set',  1);
    wrap('host_module_get_param', 'mget', 0);
    wrap('host_module_set_param', 'mset', 0);
    /* The engine's writes are all BLOCKING (the overtake param SHM is a single
     * slot, so non-blocking writes are lost) — which is exactly why leaving this
     * one unwrapped hid the most expensive calls movy makes. A live pad note on
     * a movy track used to be one of these per note, and `ipc_ms` reported
     * nothing: the "2.12 ms pad cost" it seemed to show was the chain page's
     * param refresh standing next to it. */
    wrap('host_module_set_param_blocking', 'msetb', 0);
    /* The bulk channel is one round trip for many keys, which is exactly why a
     * page refresh uses it — and exactly why leaving it out would understate the
     * tick again, this time by hiding the call that replaced eight. */
    wrap('shadow_get_params', 'bget', 1);
    wrap('shadow_set_params', 'bset', 1);
}

/* Coarse in-tick phase timing. tick_ms says the tick is slow; this says which
 * part of it is. Named phases are summed over the window and reported beside
 * the IPC breakdown. */
const phases: Record<string, number> = {};
let phaseStart = 0;
let phaseName  = '';

export function perfPhase(name: string): void {
    const now = Date.now();
    if (phaseName !== '') phases[phaseName] = (phases[phaseName] ?? 0) + (now - phaseStart);
    phaseName  = name;
    phaseStart = now;
}

export function perfPhaseEnd(): void {
    if (phaseName === '') return;
    phases[phaseName] = (phases[phaseName] ?? 0) + (Date.now() - phaseStart);
    phaseName = '';
}

let tickStart  = 0;
let inTickMs   = 0;   /* wall time inside tick() */
let periodMs   = 0;   /* wall time between successive tick() entries */
let lastEntry  = 0;
let maxPeriod  = 0;

export function perfProbeEnter(): void {
    tickStart = Date.now();
    if (lastEntry > 0) {
        const p = tickStart - lastEntry;
        periodMs += p;
        if (p > maxPeriod) maxPeriod = p;
    }
    lastEntry = tickStart;
}

/* Called once at the end of every app tick. */
export function perfProbeTick(): void {
    inTickMs += Date.now() - tickStart;
    if (callsTick > maxCalls) maxCalls = callsTick;
    callsTick = 0;
    if (++ticks < SAMPLE_TICKS) return;

    const names = Object.keys(counts);
    let total = 0, totalMs = 0;
    for (const n of names) { total += counts[n].n; totalMs += counts[n].ms; }
    names.sort((a, b) => counts[b].ms - counts[a].ms);

    let line = '';
    for (let i = 0; i < names.length && i < 6; i++) {
        const b = counts[names[i]];
        line += ' | ' + names[i] + ' n=' + (b.n / ticks).toFixed(1) + ' ms=' + (b.ms / ticks).toFixed(1);
    }
    /* period = in-tick + host-loop overhead. Splitting them says whether a slow
     * tick rate is movy's own work or the host loop's pacing. */
    const pnames = Object.keys(phases).sort((a, b) => phases[b] - phases[a]);
    let pline = '';
    for (let i = 0; i < pnames.length && i < 6; i++) {
        pline += ' ' + pnames[i] + '=' + (phases[pnames[i]] / ticks).toFixed(1);
        delete phases[pnames[i]];
    }
    for (const k of Object.keys(phases)) delete phases[k];
    if (pline) mlog('perf_phase' + pline);

    mlog('perf_ipc calls/tick=' + (total / ticks).toFixed(1)
        + ' peak=' + maxCalls
        + ' ipc_ms=' + (totalMs / ticks).toFixed(1)
        + ' tick_ms=' + (inTickMs / ticks).toFixed(1)
        + ' period_ms=' + (periodMs / ticks).toFixed(1)
        + ' peak_period=' + maxPeriod
        + line);

    counts    = {};
    tracedThisWindow = false;
    ticks     = 0;
    maxCalls  = 0;
    inTickMs  = 0;
    periodMs  = 0;
    maxPeriod = 0;
}
