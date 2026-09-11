/* Carries device-test probe requests between the harness and movy's UI.
 *
 * The harness can reach the ENGINE's params (schwung-testd routes SET_PARAM /
 * GET_PARAM into the overtake DSP) but has no way to address the UI's QuickJS
 * context. So the engine is used as a postbox: the harness writes `probereq`,
 * the UI notices and writes `probersp`.
 *
 * The notice is free. `prq=<gen>` rides the `status` poll the UI already makes,
 * so nothing here costs an IPC call until a request is actually waiting — which
 * is never, outside a test.
 */
import { answer } from '../test/probe.js';

/* The generation we last WROTE an answer for, never merely "saw".
 *
 * A one-shot `pending` flag set on a change was wrong twice over. It swallowed
 * the FIRST request after movy opened — the initial poll only recorded the
 * generation, so a request that arrived before it was never answered (measured:
 * every probe worked except the very first). And a dropped write was never
 * retried, because the flag had already been cleared.
 *
 * Comparing against the last ANSWERED generation fixes both: an unanswered
 * request stays unanswered-looking, so the next poll tries again. */
let answeredGen = -1;
let seenGen = -1;

export function noteProbeGen(gen: number): void { seenGen = gen; }

/* Called once per tick. Two IPC calls, and only when a request is waiting. */
export function probeBridgeTick(
    get: (key: string) => string | null,
    set: (key: string, value: string) => void,
): void {
    /* Generation 0 is "no request has ever been made", so there is nothing to
     * answer and no reason for a freshly opened movy to write anything. */
    if (seenGen <= 0 || seenGen === answeredGen) return;
    let rsp: string;
    try {
        rsp = answer(get('probereq') ?? '');
    } catch (e) {
        /* A probe must never be able to take movy down: it exists only to watch
         * movy, and a harness bug that threw here would look like a movy crash. */
        rsp = JSON.stringify({ error: 'probe threw: ' + String(e) });
    }
    set('probersp', rsp);
    answeredGen = seenGen;
}

export function _resetForTest(): void { answeredGen = -1; seenGen = -1; }
