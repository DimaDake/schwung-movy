/* env-identity.mjs — one env per process, however many times it is asked for.
 *
 * createDumpBoot() calls installEnv() a second time, and the globals the
 * bundled modules read are whatever the LAST call assigned. So a suite holding
 * the first env kept feeding a store nothing read: every later suite that
 * booted a model saw the dump's params instead of its own preset, silently and
 * with every assertion still green. logic.mjs ordered its suites around it.
 *
 * The same call takes a second pair off the env — `os` and `host_read_file` —
 * and that half is restored by `env.restoreHostGlobals()` rather than ordered
 * around, which is what let the ordering go and put this suite at the front of
 * the list.
 *
 * This asserts the property directly rather than the symptom, because the
 * symptom is "some later suite is subtly wrong" and that is not a test. */
import { installEnv, ok, eq, _log, env } from './harness.mjs';

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
    /* The other half of what a boot takes: the `os` the file stubs ride on and
     * `host_read_file`, which serves module layouts. Held by identity for the
     * same reason — the boot replaces both with its own, and before
     * `env.restoreHostGlobals()` nothing gave them back, so every suite after
     * this one ran on the dump's stubs. That is what put this suite between two
     * fixed ranges of logic.mjs's list; it now runs at the FRONT of it, which is
     * the position that keeps the property visible. */
    const liveOs = globalThis.os;
    const liveReadFile = globalThis.host_read_file;

    /* The real second caller, not a stand-in: the bug lives in dump-boot's own
     * call, and a hand-written installEnv() here would pass while dump-boot
     * still stole the globals. */
    await createDumpBoot(loadDump());

    ok('a dump boot does not steal the globals', globalThis.shadow_get_param === liveGet);
    ok('and takes the host off the globals',
        globalThis.os !== liveOs && globalThis.host_read_file !== liveReadFile);

    /* …and the survivor is a working host, not merely the same function. */
    first.setParams({ 'synth:env_identity_probe': '41' });
    /* (slot, key): the real `shadow_get_param` is slot-addressed, and this env's
     * stub is `(s, key) => params[s + '|' + key] ?? params[key]` — a one-arg
     * call would read `params[undefined]` and answer null whatever the store
     * held, passing for the wrong reason in one direction and failing in the
     * other. */
    eq('the live env still backs shadow_get_param',
        globalThis.shadow_get_param(0, 'synth:env_identity_probe'), '41');

    /* Every dump-driven suite's cleanup. Restoring by identity is the claim:
     * a suite can now boot a dump from any position and leave nothing behind. */
    env.restoreHostGlobals();
    ok('the restorer gives the env its host back',
        globalThis.os === liveOs && globalThis.host_read_file === liveReadFile);
    /* Reachability again, not merely identity: the restored reader is the one
     * that serves a module's shipped layout, which is what the suites this
     * suite used to have to run after actually read.
     *
     * THE PATH IS THE WHOLE ASSERTION: it has to be one the dump boot's reader
     * cannot answer. `padkeys` is a synthetic module id — a browser-test
     * fixture, never a module on any device — so that reader, a lookup over
     * what the dump holds, answers null for it while the env's answers the
     * fixture. Ask about a path BOTH readers serve and this check passes
     * with `restoreHostGlobals()` commented out: forge's `movy_config.json` is
     * served by both (the boot snapshots it, `dump-boot.mjs:131-132`) and so is
     * every `/tools/movy/configs/<id>.json` override, which the boot reads from
     * the same `src/module-configs` copy the env does. That was the first
     * version of this check — green under the mutation, claiming a
     * discrimination it did not make. */
    eq('and the restored host serves module layouts again',
        globalThis.host_read_file(
            '/data/UserData/schwung/modules/sound_generators/padkeys/movy_config.json') !== null,
        true);
}
