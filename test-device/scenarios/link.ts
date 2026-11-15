/* Ableton Link: movy-link joins the session as peer "Movy" while schwung's
 * "Movy Link" setting is on, follows and leads tempo and Start/Stop, and
 * publishes 20 Link Audio channels (docs/superpowers/specs/2026-11-15-ableton-
 * link-design.md).
 *
 * The other peer is movy-link-probe (link/movy_link_probe.cpp), run on the
 * same box: Link Audio between two peers on one host is loopback UDP, so this
 * needs no network and no Live.
 *
 * Covers:
 *   L1 setting off (the default): no peer "Movy" in the session
 *   L2 on: the engine says lk=1, the probe sees Movy and its 20 channels
 *   L3 a tempo set by the probe becomes movy's tempo
 *   L4 a subscribed channel streams: frames arrive, and a played note is heard
 *   L5 the probe's Play starts movy; L6 its Stop stops it
 *   L7 off again: lk=0 and Movy leaves the session
 * The engine is switched directly (`link`, what Settings → LINK sends), and put
 * back to the user's stored choice (prefs.json) whatever happens.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { SSH_OPTS } from '../ssh.js';
import { repoRoot } from '../engine.js';
import { until } from '../wait.js';
import type { Packet } from '../midi.js';

const run = promisify(execFile);
const PREFS = '/data/UserData/schwung/modules/tools/movy/prefs.json';
const PROBE = '/tmp/movy-link-probe';
const CHANNELS = 20;

const field = (s: string, k: string) => s.match(new RegExp(`(?:^| )${k}=(\\S+)`))?.[1] ?? '';
const line = (out: string, k: string) => out.match(new RegExp(`^${k} (.*)$`, 'm'))?.[1] ?? '';

/* A cable-2 note sounds the active track from the engine (ext-midi.ts). */
const keyOn: Packet = [0x29, 0x90, 60, 110];
const keyOff: Packet = [0x28, 0x80, 60, 0];

scenario('link', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const ssh = async (cmd: string) =>
        (await run('ssh', [...SSH_OPTS, `ableton@${t.host}`, cmd], { maxBuffer: 1 << 20 })).stdout.trim();
    const peer = (args: string) => ssh(`${PROBE} ${args}`);
    const status = async () => await t.tx.engineGet('status').catch(() => '');
    const waitStatus = async (what: string, pred: (s: string) => boolean, within = 6000) => {
        try { return await until(t.tx, what, status, pred, { within, every: 200 }); } catch { return status(); }
    };
    const setLink = (on: boolean) => t.tx.engineSet('link', on ? '1' : '0');

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);
    await run('scp', ['-q', ...SSH_OPTS, join(repoRoot(), 'dist', 'movy-link-probe'), `ableton@${t.host}:${PROBE}`]);
    const userOn = /"link"\s*:\s*true/.test(await ssh(`cat ${PREFS} 2>/dev/null || true`));

    try {
        await setLink(false);
        const off = await peer('--wait 2');
        t.check('l1-off', 'with Link off, Movy is not in the session',
            /* Channels, not the peer count: another Link app (Live on the
             * owner's Mac) may share the session, and Movy announces channels
             * only while it is in it. */
            !/^channel /m.test(off), { expected: 'no Movy channels', actual: off.replace(/\n/g, ' | ') });

        await setLink(true);
        const st = await waitStatus('lk=1', (s) => field(s, 'lk') === '1');
        const on = await peer('--wait 2');
        const chans = (on.match(/^channel /gm) ?? []).length;
        t.check('l2-joins', 'setting on: lk=1, and the probe sees Movy with 20 channels',
            field(st, 'lk') === '1' && Number(line(on, 'peers')) >= 1 && chans === CHANNELS,
            { expected: `lk=1, peers >= 1, ${CHANNELS} channels`, actual: `lk=${field(st, 'lk')} peers=${line(on, 'peers')} channels=${chans}` });

        await peer('--tempo 133 --wait 1');
        const bpm = field(await waitStatus('bpm=13300', (s) => field(s, 'bpm') === '13300'), 'bpm');
        t.check('l3-follows-tempo', 'a session tempo set by another peer becomes movy\'s', bpm === '13300',
            { expected: 'bpm=13300', actual: `bpm=${bpm}` });

        await dev.selectTrack(0);
        await ssh(`rm -f /tmp/probe.out; nohup ${PROBE} --subscribe 'Movy 1' --wait 4 >/tmp/probe.out 2>&1 &`);
        await t.tx.frames(700);                 // ~2 s: subscribed, streaming silence
        await t.tx.uiMidi(keyOn);
        await t.tx.frames(300);
        await t.tx.uiMidi(keyOff);
        await until(t.tx, 'the probe to finish', () => ssh('cat /tmp/probe.out'), (o) => /^frames /m.test(o), { within: 8000, every: 300 }).catch(() => '');
        const sub = await ssh('cat /tmp/probe.out');
        const [frames, peak] = (line(sub, 'frames').match(/(\d+) peak (\d+)/) ?? []).slice(1).map(Number);
        t.note('subscribe', sub.replace(/\n/g, ' | '));
        t.check('l4-audio-streams', 'a subscribed track channel streams, and a played note is heard on it',
            (frames ?? 0) > 44100 && (peak ?? 0) > 300, { expected: 'frames > 44100 (1 s), peak > 300', actual: `frames=${frames} peak=${peak}` });

        await peer('--play --wait 1.5');
        const playing = field(await waitStatus('play=1', (s) => field(s, 'play') === '1'), 'play');
        t.check('l5-remote-play', 'the session\'s Play starts movy (on its next bar)', playing === '1',
            { expected: 'play=1', actual: `play=${playing}` });
        await peer('--stop --wait 1');
        const stopped = field(await waitStatus('play=0', (s) => field(s, 'play') === '0'), 'play');
        t.check('l6-remote-stop', 'the session\'s Stop stops movy', stopped === '0',
            { expected: 'play=0', actual: `play=${stopped}` });

        await setLink(false);
        const st2 = await waitStatus('lk=0', (s) => field(s, 'lk') === '0');
        const gone = await peer('--wait 2');
        t.check('l7-off-again', 'setting off: lk=0 and Movy leaves the session',
            field(st2, 'lk') === '0' && !/^channel /m.test(gone),
            { expected: 'lk=0, no Movy channels', actual: `lk=${field(st2, 'lk')} | ${gone.replace(/\n/g, ' | ')}` });
    } finally {
        await setLink(userOn).catch(() => {});
        await t.tx.engineSet('cmd', 'stop').catch(() => {});
    }
});
