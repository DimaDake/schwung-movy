/* browser-test/logic/host-param.mjs — the one door to the param channel.
 *
 * The point of `src/host/param.ts` is that a refused write is COUNTABLE. Every
 * assertion here is about that: what counts as a refusal, what does not, and
 * that a caller still gets the verdict it needs to act on. A dropped write is
 * silent on device, so if these counters lie nothing else will contradict them.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
    const {
        paramAvailable, paramGet, paramSet, paramGetMany, paramSetMany,
        paramStats, resetParamStats,
    } = await import('../../dist/esm/host/param.js');
    const { encodeBulk } = await import('../../dist/esm/track/bulk.js');

    /* The harness installs ambient host globals that every later suite reads
     * through. Swapped, not clobbered. */
    const saved = {
        set: globalThis.host_module_set_param,
        setb: globalThis.host_module_set_param_blocking,
        get: globalThis.host_module_get_param,
        bulkGet: globalThis.shadow_get_params,
        bulkSet: globalThis.shadow_set_params,
    };

    const writes = [];
    let refuse = false;
    let blockingReturns = true;
    globalThis.host_module_set_param = (k, v) => { writes.push([k, v]); };
    globalThis.host_module_set_param_blocking = (k, v) => {
        if (refuse) return false;
        writes.push([k, v]);
        return blockingReturns;
    };
    let reads = {};
    globalThis.host_module_get_param = (k) => (k in reads ? reads[k] : null);

    _log('\nhost param channel: a refused write is counted, not swallowed');
    resetParamStats();

    eq('the channel reports itself available', paramAvailable(), true);

    /* A write that lands. */
    ok('a delivered write reports success', paramSet('cmd', 'play') === true);
    eq('and is not counted as a refusal', paramStats().refused, 0);
    eq('but is counted as a write', paramStats().sets, 1);

    /* A write the slot refuses. This is the case that was invisible: before
     * host/param.ts there was no number anywhere that moved when it happened. */
    refuse = true;
    ok('a refused write reports failure', paramSet('cmd', 'stop') === false);
    eq('the refusal is counted', paramStats().refused, 1);
    eq('and names the key it was carrying', paramStats().lastRefusedKey, 'cmd');
    eq('a refused write reaches the host with nothing', writes.length, 1);

    /* A host binding that answers nothing at all is NOT evidence of a loss.
     * Treating undefined as a refusal would make every counter a fiction on any
     * host whose shim predates the boolean return. */
    refuse = false;
    blockingReturns = undefined;
    ok('a host that returns nothing counts as delivered', paramSet('cmd', 'play') === true);
    eq('and adds no refusal', paramStats().refused, 1);
    blockingReturns = true;

    /* Reads. A null answer is the engine being silent, which is worth counting
     * for the same reason — it is how a vanished engine first shows up. */
    reads = { status: 'play=1' };
    eq('a read answers', paramGet('status'), 'play=1');
    eq('a silent read answers null', paramGet('capinfo'), null);
    eq('reads are counted', paramStats().gets, 2);
    eq('and the silent one is counted apart', paramStats().getNulls, 1);

    _log('\nhost param channel: bulk');
    resetParamStats();

    /* The bulk read is the whole reason a param page is affordable. Its failure
     * mode is the dangerous one: a short response read as "every param is
     * empty" paints a page of zeroed knobs over the user's real values. */
    globalThis.shadow_get_params = () => encodeBulk(['1', '2']);
    eq('a well-formed bulk read answers in order',
        paramGetMany(['a', 'b']).join(','), '1,2');
    eq('and costs no single reads', paramStats().gets, 0);
    eq('and no fallback', paramStats().bulkFallbacks, 0);

    reads = { a: 'A', b: 'B' };
    globalThis.shadow_get_params = () => encodeBulk(['1']);   // short: one value for two keys
    eq('a SHORT bulk response falls back to single reads',
        paramGetMany(['a', 'b']).join(','), 'A,B');
    eq('the fallback is counted', paramStats().bulkFallbacks, 1);
    eq('and it really did read singly', paramStats().gets, 2);

    globalThis.shadow_get_params = () => null;
    eq('a null bulk response falls back too',
        paramGetMany(['a', 'b']).join(','), 'A,B');
    eq('counted as a second fallback', paramStats().bulkFallbacks, 2);

    /* An empty value in a bulk answer is "no value", not the string "". */
    globalThis.shadow_get_params = () => encodeBulk(['', 'B']);
    eq('an empty bulk value reads as null',
        String(paramGetMany(['a', 'b'])[0]), 'null');

    resetParamStats();
    globalThis.shadow_set_params = () => true;
    ok('a bulk write reports success', paramSetMany([['a', '1'], ['b', '2']]) === true);
    eq('and counts every pair as a write', paramStats().sets, 2);
    globalThis.shadow_set_params = () => false;
    ok('a refused bulk write reports failure', paramSetMany([['a', '1'], ['b', '2']]) === false);
    eq('and counts every pair as refused', paramStats().refused, 2);

    resetParamStats();
    eq('the stats reset', paramStats().sets + paramStats().refused + paramStats().gets, 0);

    globalThis.host_module_set_param = saved.set;
    globalThis.host_module_set_param_blocking = saved.setb;
    globalThis.host_module_get_param = saved.get;
    globalThis.shadow_get_params = saved.bulkGet;
    globalThis.shadow_set_params = saved.bulkSet;
}
