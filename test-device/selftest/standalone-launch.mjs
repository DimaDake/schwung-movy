/* Host-only: the standalone transport's launch is single-flight.
 *
 * Two launches in the same instant both ran launch-standalone.sh. movy-host's
 * session lock kept the second process out, but that launch-standalone.sh then
 * restarted Move underneath the first one, and the tier hung for 20 min
 * (2026-10-10). Concurrent callers must share ONE launch, and a launch after
 * it settles must run again, not reuse a stale promise.
 */
import { StandaloneTransport } from '../dist/transport-standalone.js';

let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const tx = new StandaloneTransport('selftest.invalid');
let calls = 0;
tx.launchOnce = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); };
await Promise.all([tx.launch(), tx.launch(), tx.launch()]);
ok('three concurrent launches run launch-standalone.sh once', calls === 1, `ran ${calls}`);
await tx.launch();
ok('a launch after it settled runs again', calls === 2, `ran ${calls}`);

tx.launchOnce = async () => { calls++; throw new Error('boom'); };
await tx.launch().catch(() => {});
tx.launchOnce = async () => { calls++; };
await tx.launch();
ok('a failed launch does not wedge the next one', calls === 4, `ran ${calls}`);

process.exit(fails ? 1 : 0);
