/* The one-time copy of schwung's per-Set master into movy's own master.
 *
 * Copy forward, never clean up: schwung's `set_state/<uuid>/master_fx_N.json`
 * is READ, never written, cleared or enforced empty, so a downgrade to the
 * overtake binding still finds everything it left. A file read rather than a
 * shim query, so it works in standalone where there is no shim to ask.
 *
 * Runs when the engine has applied a Set (`sapl` moved) whose movy master was
 * never imported, and only while movy's master is the bound one. Two phases:
 * the modules and their preset blobs first (the engine queues the loads and
 * attaches each blob to its load), then — once nothing is pending — the
 * loose params, bypass and LFOs, because an LFO cannot bind to a position
 * that is not loaded yet. The mark goes last, whatever was found, so a master
 * the user clears on purpose stays cleared.
 *
 * Design: docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md §5.4. */

import { platform } from '../platform/index.js';
import { mlog } from '../log.js';
import { MOVY_MASTER_PREFIX as P } from './master-prefix.js';
import { movyMasterBound } from './master-binding.js';

const SET_STATE_DIR = '/data/UserData/schwung/set_state/';
const MASTER_FX = 4;
/* The fields schwung's `lfoN:config` carries that the chain host also takes
 * under `lfoN:` — the same names on both sides. `division_table_version` is
 * schwung's bookkeeping, not a param. */
const LFO_FIELDS = ['enabled', 'shape', 'sync', 'rate_hz', 'rate_div',
    'depth', 'polarity', 'phase_offset', 'target', 'target_param'];
/* Polls (~24 Hz) to wait for the loads before writing phase 2 anyway. */
const SETTLE_POLLS = 480;

export type Pair = [string, string];
export interface ImportPlan { first: Pair[]; second: Pair[]; modules: string[] }

type Json = Record<string, unknown>;

function parse(text: string | null): Json | null {
    if (!text) return null;
    try {
        const o = JSON.parse(text);
        return o && typeof o === 'object' && !Array.isArray(o) ? o as Json : null;
    } catch { return null; }
}

function str(v: unknown): string | null {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return null;
}

/** What to write for these four files' contents (null = missing). Pure. */
export function planMasterImport(files: (string | null)[]): ImportPlan {
    const plan: ImportPlan = { first: [], second: [], modules: [] };
    const lfoPairs: Pair[] = [];
    for (let i = 0; i < MASTER_FX; i++) {
        const o = parse(files[i] ?? null);
        if (!o) { plan.modules.push(''); continue; }
        const fx = P + 'fx' + (i + 1) + ':';
        const id = typeof o.module_id === 'string' ? o.module_id : '';
        plan.modules.push(id);
        if (id) {
            plan.first.push([fx + 'module', id]);
            /* schwung stores a JSON state parsed, and anything else opaque —
             * the module was handed a string either way. */
            const state = typeof o.state === 'string' ? o.state
                : o.state && typeof o.state === 'object' ? JSON.stringify(o.state) : null;
            if (state) plan.first.push([fx + 'state', state]);
            else if (o.params && typeof o.params === 'object') {
                for (const [k, v] of Object.entries(o.params as Json)) {
                    const s = str(v);
                    if (s !== null) plan.second.push([fx + k, s]);
                }
            }
            const byp = str(o.bypassed);
            if (byp !== null) plan.second.push([fx + 'bypassed', byp]);
        }
        /* The LFOs ride position 0's file even when position 0 is empty. */
        if (i === 0 && o.lfos && typeof o.lfos === 'object') {
            for (let n = 1; n <= 2; n++) {
                const l = (o.lfos as Json)['lfo' + n];
                if (!l || typeof l !== 'object') continue;
                for (const f of LFO_FIELDS) {
                    const s = str((l as Json)[f]);
                    if (s !== null) lfoPairs.push([P + 'lfo' + n + ':' + f, s]);
                }
            }
        }
    }
    plan.second.push(...lfoPairs);
    return plan;
}

type Get = (key: string) => string | null;
type Set = (key: string, value: string) => void;

let armed = false;
let pendingSecond: Pair[] | null = null;
let settle = 0;

/** A Set was applied: check it on the next poll. */
export function requestMasterImport(): void { armed = true; }

/** Forget an import in flight — a new engine or a test. */
export function resetMasterImport(): void { armed = false; pendingSecond = null; settle = 0; }

/** One step, on the status poll. `pending` is the engine's queued loads. */
export function masterImportTick(uuid: string, pending: number, get: Get, set: Set): void {
    if (pendingSecond) {
        if (pending > 0 && --settle > 0) return;
        for (const [k, v] of pendingSecond) set(k, v);
        pendingSecond = null;
        set(P + 'imported', '1');
        return;
    }
    if (!armed) return;
    armed = false;
    if (!uuid || !movyMasterBound() || get(P + 'imported') !== '0') return;
    const dir = SET_STATE_DIR + uuid + '/';
    const files: (string | null)[] = [];
    for (let i = 0; i < MASTER_FX; i++) files.push(platform.readFile(dir + 'master_fx_' + i + '.json'));
    const plan = planMasterImport(files);
    mlog('master import: ' + uuid + ' ' + plan.modules.map((m) => m || '-').join(',')
        + ' writes=' + (plan.first.length + plan.second.length));
    for (const [k, v] of plan.first) set(k, v);
    pendingSecond = plan.second;
    settle = SETTLE_POLLS;
}
