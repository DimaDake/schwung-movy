/* env-identity.mjs — one env per process, however many times it is asked for.
 *
 * createDumpBoot() calls installEnv() a second time, and the globals the
 * bundled modules read are whatever the LAST call assigned. So a suite holding
 * the first env kept feeding a store nothing read: every later suite that
 * booted a model saw the dump's params instead of its own preset, silently and
 * with every assertion still green. logic.mjs ordered its suites around it.
 *
 * This asserts the property directly rather than the symptom, because the
 * symptom is "some later suite is subtly wrong" and that is not a test. */
import { installEnv, ok, eq, _log } from './harness.mjs';

export async function run() {
    _log('\nlogic: one env per process');

    const { loadDump, createDumpBoot } = await import('../dump-boot.mjs');

    const first = installEnv();
    eq('installEnv is idempotent', installEnv(), first);
    /* Identity, not reachability — the two checks below are different claims.
     * This one holds the exact accessor the globals pointed at before the dump
     * boot; a second env repoints them at its own, so a `===` here fails on the
     * leak itself rather than on its downstream symptom. */
    const liveGet = globalThis.shadow_get_param;

    /* The real second caller, not a stand-in: the bug lives in dump-boot's own
     * call, and a hand-written installEnv() here would pass while dump-boot
     * still stole the globals. */
    await createDumpBoot(loadDump());

    ok('a dump boot does not steal the globals', globalThis.shadow_get_param === liveGet);

    /* …and the survivor is a working host, not merely the same function. */
    first.setParams({ 'synth:env_identity_probe': '41' });
    /* (slot, key): the real `shadow_get_param` is slot-addressed, and this env's
     * stub is `(s, key) => params[s + '|' + key] ?? params[key]` — a one-arg
     * call would read `params[undefined]` and answer null whatever the store
     * held, passing for the wrong reason in one direction and failing in the
     * other. */
    eq('the live env still backs shadow_get_param',
        globalThis.shadow_get_param(0, 'synth:env_identity_probe'), '41');
}
