/* The only file that talks IPC for the sequencer.
 *
 * Commands queue up during an app tick and flush as ONE batched
 * `set_param("cmd", "op;op;…")` — the overtake-DSP param channel can
 * coalesce (only the last write per audio buffer survives), so multiple ops
 * must travel in a single value. Status comes back via one
 * `get_param("status")` poll every STATUS_POLL_TICKS; each get blocks
 * ~3-5 ms on device, so the cadence is a deliberate IPC budget. */

import { mlog } from '../log.js';
import { seqState } from './state.js';

const STATUS_POLL_TICKS = 8; // ~24 Hz at the ~196 Hz device tick rate
const MAX_STATUS_FAILURES = 16;

const cmdQueue: string[] = [];
let pollCountdown = 1;
let statusFailures = 0;

export function engineAvailable(): boolean {
    return typeof host_module_set_param === 'function'
        && typeof host_module_get_param === 'function';
}

/* Queue one engine op, e.g. "play" or "non 0 60 100". Sent on next tick. */
export function seqCmd(op: string): void {
    cmdQueue.push(op);
}

export function seqEngineTick(): void {
    if (!engineAvailable() || statusFailures >= MAX_STATUS_FAILURES) return;
    if (cmdQueue.length > 0) {
        host_module_set_param('cmd', cmdQueue.join(';'));
        cmdQueue.length = 0;
    }
    if (--pollCountdown <= 0) {
        pollCountdown = STATUS_POLL_TICKS;
        const s = host_module_get_param('status');
        if (s === null) {
            /* Engine absent or pre-protocol build: stop wasting blocking
             * IPC after repeated failures. */
            statusFailures++;
            if (statusFailures === MAX_STATUS_FAILURES) {
                mlog('seq: engine status unavailable — polling disabled');
            }
            return;
        }
        statusFailures = 0;
        parseStatus(s);
    }
}

/* Status format: space-separated key=value pairs, e.g.
 * "play=1 tick=4321 bpm=12000". Unknown keys are ignored so the engine can
 * extend the format without breaking older UIs. */
function parseStatus(s: string): void {
    seqState.engineOk = true;
    for (const kv of s.split(' ')) {
        const eq = kv.indexOf('=');
        if (eq <= 0) continue;
        const key = kv.slice(0, eq);
        const val = kv.slice(eq + 1);
        if (key === 'play') seqState.playing = val === '1';
        else if (key === 'tick') seqState.engineTick = Number(val) || 0;
        else if (key === 'bpm') seqState.bpmX100 = Number(val) || seqState.bpmX100;
    }
}

/* Test hook: clear queue/backoff between test cases. */
export function resetSeqEngine(): void {
    cmdQueue.length = 0;
    pollCountdown = 1;
    statusFailures = 0;
}
