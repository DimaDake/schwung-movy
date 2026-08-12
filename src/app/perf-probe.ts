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

function wrap(fnName: string, kind: string, keyArg: number): void {
    const g = globalThis as Record<string, unknown>;
    const orig = g[fnName];
    if (typeof orig !== 'function') return;
    /* Re-opening the tool re-evaluates ui.js — module state resets, but the host
     * globals persist and are already wrapped. Marking the wrapper (rather than
     * trusting a module-level flag) is what stops a second open from wrapping
     * the wrapper and double-counting every call. */
    if ((orig as { _movyProbe?: boolean })._movyProbe) return;
    const fn = orig as (...a: unknown[]) => unknown;
    const wrapped = function (...args: unknown[]): unknown {
        const t0 = Date.now();
        const r  = fn.apply(null, args);
        record(label(kind, args[keyArg]), Date.now() - t0);
        return r;
    };
    (wrapped as { _movyProbe?: boolean })._movyProbe = true;
    g[fnName] = wrapped;
}

export function installPerfProbe(): void {
    if (installed) return;
    installed = true;
    wrap('shadow_get_param',      'get',  1);
    wrap('shadow_set_param',      'set',  1);
    wrap('host_module_get_param', 'mget', 0);
    wrap('host_module_set_param', 'mset', 0);
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
