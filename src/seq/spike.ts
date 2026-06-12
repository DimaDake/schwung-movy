/* TEMPORARY — Step 0 integration spike. Exercises the Rust engine end to end
 * on device: param round-trip, channel-addressed notes to all 4 tracks, and
 * the audible click. Driven from app/tick.ts; logs are asserted by
 * scripts/test-dsp-spike.sh. Removed once the real seq UI lands (Step 1+). */

import { mlog } from '../log.js';

let t = 0;
let finished = false;

function engineGet(key: string): string | null {
    if (typeof host_module_get_param !== 'function') return null;
    return host_module_get_param(key);
}

function engineSet(key: string, value: string): void {
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param(key, value);
}

export function seqSpikeTick(): void {
    if (finished) return;
    t++;
    if (t === 100) {
        const pong = engineGet('ping');
        mlog('spike ping -> ' + (pong ?? 'null (no engine)'));
        if (pong === null) finished = true;
        return;
    }
    /* one test note per track, staggered ~1s apart (~196 ticks/s on device) */
    if (t === 300) engineSet('test_note', '0 60 100');
    if (t === 500) engineSet('test_note', '1 64 100');
    if (t === 700) engineSet('test_note', '2 67 100');
    if (t === 900) engineSet('test_note', '3 72 100');
    if (t === 1100) engineSet('test_click', '4');
    if (t === 1700) {
        mlog('spike stats -> ' + (engineGet('spike') ?? 'null'));
        mlog('spike tick_count -> ' + (engineGet('tick_count') ?? 'null'));
        finished = true;
    }
}
