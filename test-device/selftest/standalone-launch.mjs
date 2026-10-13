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

/* The bus connects lazily, and movy-host's bus serves ONE client at a time (a
 * second waits in the backlog, host/testbus.c). Two first calls in the same
 * instant each opened a connection; the second overwrote the first, so the
 * connection the server was serving leaked and every later command queued
 * behind it forever: the tier hung after versions threw (2026-10-11). Against
 * a real one-at-a-time server, concurrent first calls must share one link. */
{
    const net = await import('node:net');
    const queue = [];
    let busy = false, conns = 0;
    const serveNext = () => {
        if (busy || !queue.length) return;
        busy = true;
        const s = queue.shift();
        let buf = '';
        s.on('data', (d) => {
            buf += d;
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0) { buf = buf.slice(nl + 1); s.write('OK pong\n'); }
        });
        s.on('close', () => { busy = false; serveNext(); });
    };
    const server = net.createServer((s) => { conns++; queue.push(s); serveNext(); });
    const listening = await new Promise((res) => {
        server.once('error', () => res(false));
        server.listen(47777, '127.0.0.1', () => res(true));
    });
    if (!listening) ok('a local port 47777 for the one-client bus test', false, 'port in use');
    else {
        const tx = new StandaloneTransport('127.0.0.1');
        const within = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('HUNG'), 1500))]);
        const first = await within(Promise.all([tx.ping(), tx.ping(), tx.ping()]));
        ok('concurrent first calls share one bus connection', first !== 'HUNG' && conns === 1,
           `${first === 'HUNG' ? 'hung' : 'answered'}, ${conns} connection(s)`);
        ok('...and the next call is still answered', await within(tx.ping()) !== 'HUNG');
        tx.bus?.close();
        for (const s of queue) s.destroy();
        server.close();
    }
}

/* A movy-host the harness did not start (the boot door, movy as the default
 * target) has no bus: the flag is read only at startup. Adopting it means stop
 * + TERM, then a start that reads the flag. One of ours mid-start, or one whose
 * bus answers, must be left alone. */
{
    const mk = ({ age, cmdline, bus }) => {
        const tx = new StandaloneTransport('selftest.invalid');
        const root = [];
        let alive = true, started = false;
        tx.ssh = async (user, cmd) => {
            if (user === 'root') { root.push(cmd); if (/kill -TERM/.test(cmd)) alive = false; if (/move start/.test(cmd)) started = true; return ''; }
            if (cmd.startsWith('pidof movy-host')) return alive ? '4242\n' : '\n';
            if (cmd.startsWith('awk')) return age + '\n';
            if (cmd.startsWith('tr ')) return cmdline;
            return '';
        };
        tx.state = async () => (started ? { running: 1, engine_ready: 1 } : bus ? { running: 0 } : {});
        return { tx, root };
    };
    {
        const { tx, root } = mk({ age: 80, cmdline: 'movy-host --boot ', bus: false });
        const r = await tx.adoptForeignHost();
        ok('a busless boot-door host is restarted with the flag', r === true
           && /move stop/.test(root[0] ?? '') && /kill -TERM 4242/.test(root[0] ?? '') && /movy-testbus.*move start/.test(root[1] ?? ''),
           `adopted=${r} root=${JSON.stringify(root)}`);
    }
    {
        const { tx, root } = mk({ age: 80, cmdline: 'movy-host ', bus: false });
        const r = await tx.adoptForeignHost();
        ok('a busless Tools-door host is TERMed and left to its launcher', r === false
           && root.length === 1 && !/move stop/.test(root[0]) && /kill -TERM 4242/.test(root[0]),
           `adopted=${r} root=${JSON.stringify(root)}`);
    }
    {
        const { tx, root } = mk({ age: 1, cmdline: 'movy-host --boot ', bus: false });
        ok('a host younger than 3 s is not touched (its bus may not listen yet)',
           await tx.adoptForeignHost() === false && root.length === 0, JSON.stringify(root));
    }
    {
        const { tx, root } = mk({ age: 80, cmdline: 'movy-host --boot ', bus: true });
        ok('a host whose bus answers is not touched',
           await tx.adoptForeignHost() === false && root.length === 0, JSON.stringify(root));
    }
}

/* A press made while movy-host is still starting finds its bus not listening
 * yet: the connect is REFUSED. By the time the transport asks whether the host
 * runs, the bus may be up — and the refusal was then rethrown as a lost link,
 * failing seq's boot-gate pump on all three attempts (2026-10-13). A refused
 * connect is "not up yet", never a link that dropped; a link that drops while
 * the host runs still throws. */
{
    const tx = new StandaloneTransport('selftest.invalid');
    tx.running = async () => true;
    const refused = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
    tx.call = async () => { throw refused; };
    const r1 = await tx.uiMidi([0x09, 0x90, 60, 100]).then(() => 'ok', (e) => e);
    ok('a press refused by a host still starting is swallowed', r1 === 'ok', String(r1?.code ?? r1));
    const f1 = await tx.frames(1).then(() => 'ok', (e) => e);
    ok('...and so is a frame wait', f1 === 'ok', String(f1?.code ?? f1));

    tx.call = async () => { throw new Error('bus: connection closed'); };
    const r2 = await tx.uiMidi([0x09, 0x90, 60, 100]).then(() => 'ok', (e) => e);
    ok('a link lost while the host runs still throws', r2 !== 'ok');
}

process.exit(fails ? 1 : 0);
