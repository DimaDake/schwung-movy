/* browser-test/logic/host-param.mjs — the one door to the engine.
 *
 * Since WP10 a write goes into movy-host's ordered queue and the caller moves
 * on: no wait, no refusal accounting. What is left to pin is that a write
 * reaches the host as a plain set (never the blocking call that cost a frame),
 * that `false` still means "no engine", and the read-side health counters.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
    const {
        paramGet, paramSet, paramGetMany, paramSetMany,
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
    let loaded = true;
    let blockingCalls = 0;
    globalThis.host_module_set_param = (k, v) => { if (!loaded) return false; writes.push([k, v]); return true; };
    globalThis.host_module_set_param_blocking = () => { blockingCalls++; return true; };
    let reads = {};
    globalThis.host_module_get_param = (k) => (k in reads ? reads[k] : null);

    _log('\nhost param channel: a write is queued, not waited on');
    resetParamStats();

    ok('a write reports success', paramSet('cmd', 'play') === true);
    eq('it reached the host', writes.length, 1);
    eq('as a plain set: nothing waits a frame for it', blockingCalls, 0);
    eq('and is counted as a write', paramStats().sets, 1);

    /* The one failure left: movy-host refuses a set when no engine is loaded. */
    loaded = false;
    ok('with no engine a write reports failure', paramSet('cmd', 'stop') === false);
    loaded = true;

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
    ok('with no engine a bulk write reports failure', paramSetMany([['a', '1'], ['b', '2']]) === false);

    resetParamStats();
    eq('the stats reset', paramStats().sets + paramStats().gets + paramStats().bulkFallbacks, 0);

    globalThis.host_module_set_param = saved.set;
    globalThis.host_module_set_param_blocking = saved.setb;
    globalThis.host_module_get_param = saved.get;
    globalThis.shadow_get_params = saved.bulkGet;
    globalThis.shadow_set_params = saved.bulkSet;
}
