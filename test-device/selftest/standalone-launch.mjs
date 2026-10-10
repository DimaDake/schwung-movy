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

/* Open from the launcher's hold while the PREVIOUS movy-host is still
 * tearing down: `pidof` answers `up` for ~150 ms after its UI stopped. The
 * open must keep offering `go` until the hold appears, not take the exiting
 * process for the new one (seq's close-then-open timed out on exactly that). */
{
    const tx = new StandaloneTransport('selftest.invalid');
    const script = ['up', 'up', 'sent'];
    const sentAt = [];
    let polls = 0, running = 0;
    tx.ssh = async () => { const r = script.shift() ?? 'up'; if (r === 'sent') { sentAt.push(polls); running = polls + 2; } return r + '\n'; };
    tx.state = async () => { polls++; return running && polls >= running ? { running: 1, engine_ready: 1 } : { running: 0 }; };
    const ok1 = await tx.fromHold().catch((e) => e);
    ok('an exiting host is not the new one: go is sent once the hold appears', ok1 === true && sentAt.length === 1,
       `result ${ok1}, go sent ${sentAt.length}x`);
    tx.ssh = async () => 'none\n';
    tx.state = async () => ({ running: 0 });
    ok('no launcher: the open goes the Move way', await tx.fromHold() === false);
}

process.exit(fails ? 1 : 0);
