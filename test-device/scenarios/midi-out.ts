/* The third-party MIDI Out module (chaolue/schwung-midi-out) in a movy track's
 * MIDI FX slot must put the track's notes on USB-A.
 *
 * What it proves: a pad played on track 0 reaches the module's on_midi through
 * movy's chain host, the module's midi_send_external lands on movy's vtable
 * copy, and the packets leave on cable 2 of the SPI out mailbox, on the channel
 * the module was told — which is what the midi_out tap shows.
 *
 * Covers:
 *   O1 with MIDI Out loaded, a pad press puts note-on and note-off on cable 2,
 *      on the channel set on the module
 *   O2 changing the channel moves the output (the param reaches the module)
 *   O3 control: with the slot emptied the same press puts nothing on cable 2
 *      (O1 is not vacuous — something else on cable 2 would fail this)
 *
 * The module is third-party and not part of movy, so a box may not have it:
 * the virtual device's /data snapshot predates its install. The scenario then
 * installs the pinned release itself rather than grading the box's inventory.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { PAD_NOTE_BASE } from '../midi.js';
import { SSH_OPTS } from '../ssh.js';

const run = promisify(execFile);
const MODULE = 'midi-out';
const SLOT = 'ch0:midi_fx1';
const RELEASE = 'https://github.com/chaolue/schwung-midi-out/releases/download/v0.2.0/midi-out-module.tar.gz';
const MODULES = '/data/UserData/schwung/modules/midi_fx';

/* Staged under /data and swapped in by rename, as the module's own
 * install.sh does: /tmp on a Move sits on a root filesystem that is usually
 * full. */
async function ensureInstalled(host: string): Promise<boolean> {
    const ssh = async (cmd: string) => (await run('ssh', [...SSH_OPTS, `ableton@${host}`, cmd])).stdout;
    if ((await ssh(`test -f ${MODULES}/${MODULE}/dsp.so && echo y || true`)).trim() === 'y') return false;
    const cache = join(tmpdir(), 'movy-test-midi-out');
    const tgz = join(cache, 'midi-out-v0.2.0.tar.gz');
    if (!existsSync(tgz)) {
        mkdirSync(cache, { recursive: true });
        await run('curl', ['-fsSL', '-o', tgz, RELEASE]);
    }
    const stage = '/data/UserData/schwung/.install-staging/midi-out';
    await ssh(`rm -rf ${stage} && mkdir -p ${stage} ${MODULES}`);
    await run('scp', ['-q', ...SSH_OPTS, tgz, `ableton@${host}:${stage}/module.tar.gz`]);
    await ssh(`set -e; cd ${stage}; tar -xzf module.tar.gz; test -f ${MODULE}/dsp.so; `
        + `rm -rf ${MODULES}/${MODULE}; mv ${MODULE} ${MODULES}/${MODULE}; cd /; rm -rf ${stage}`);
    return true;
}

scenario('midi-out', async (t) => {
    t.note('installed', await ensureInstalled(t.host));
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const hb = t.tx.hostBus!;
    const ep = (key: string, value: string): Promise<void> => t.tx.engineSetQueued(key, value);

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);
    const before = await t.tx.engineGet(`${SLOT}_module`).catch(() => '');
    t.note('midiFx1Before', before);
    t.need.register(async () => { await ep(`${SLOT}:module`, before); });

    /* Cable 2 is USB-A; a cable-0/1 packet is an LED or Move's own traffic. */
    const usbA = async (chan: number) => {
        await hb.subscribeMidiOut();
        await dev.tap.note(PAD_NOTE_BASE, 100);
        await t.tx.frames(60);
        const evs = await hb.dumpMidiOut();
        return evs.filter((e) => (e.bytes[0] >> 4) === 2 && (e.bytes[1] & 0x0F) === chan - 1);
    };
    const onOff = (evs: { bytes: number[] }[]) => ({
        on: evs.filter((e) => (e.bytes[1] & 0xF0) === 0x90 && e.bytes[3] > 0).length,
        off: evs.filter((e) => (e.bytes[1] & 0xF0) === 0x80 || ((e.bytes[1] & 0xF0) === 0x90 && e.bytes[3] === 0)).length,
    });

    await ep(`${SLOT}:module`, MODULE);
    const loaded = await until(t.tx, 'midi-out to load in midi_fx1', () => t.tx.engineGet(`${SLOT}_module`),
        (v) => v === MODULE, { within: 6000, every: 200 }).catch(() => t.tx.engineGet(`${SLOT}_module`));
    t.check('loaded', 'MIDI Out loads into the track MIDI FX slot',
        loaded === MODULE, { expected: MODULE, actual: loaded || '(empty)' });

    await ep(`${SLOT}:channel`, '5');
    await t.tx.frames(30);
    const e5 = await usbA(5);
    t.note('chan5', e5);
    const c5 = onOff(e5);
    t.check('usb-a-notes', 'a pad press leaves on cable 2 as note-on and note-off on channel 5',
        c5.on >= 1 && c5.off >= 1, { expected: '>=1 note-on and >=1 note-off, cable 2, ch 5', actual: JSON.stringify({ ...c5, evs: e5 }) });

    await ep(`${SLOT}:channel`, '9');
    await t.tx.frames(30);
    const e9 = await usbA(9);
    const stale = (await usbA(5)).length;
    t.check('usb-a-channel', 'changing the module channel moves the output to channel 9',
        onOff(e9).on >= 1 && stale === 0, { expected: 'note-on on ch 9, nothing new on ch 5', actual: JSON.stringify({ ch9: onOff(e9), ch5: stale }) });

    await ep(`${SLOT}:module`, '');
    await until(t.tx, 'the slot to empty', () => t.tx.engineGet(`${SLOT}_module`), (v) => v === '', { within: 6000, every: 200 }).catch(() => '');
    await t.tx.frames(30);
    const none = [...(await usbA(5)), ...(await usbA(9))];
    t.check('usb-a-control', 'with the slot emptied the same press puts nothing on cable 2',
        none.length === 0, { expected: '0 cable-2 channel 5/9 packets', actual: JSON.stringify(none) });
});
