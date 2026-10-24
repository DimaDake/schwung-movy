#!/usr/bin/env node
/* measure-freeze-cpu.mjs — what freezing gives back (FROZEN-DOC.md; plan
 * 2026-10-23-stems-freeze-export-wifi.md, F3), measured on movy-host.
 *
 *   npm run build:test-device
 *   node scripts/measure-freeze-cpu.mjs [host] [--modules a,b,..] [--bpm 120] [--sd-probe] [--stop-probe] [--thaw N]
 *
 * One chain per module (default eight), each with a one-bar clip of chords so
 * the freeze has something to record and the synth has voices to run. With
 * the transport playing: a baseline window, then the tracks are frozen one at
 * a time (each waits for its capture to end) and a window is measured after
 * each, then every track is unfrozen and measured once more — that last
 * window must come back to the baseline, or the thaw did not restore it.
 *
 * Each window reports the render wall (`chain cost:` wall, the CPU page's
 * numerator) as a share of the 2902 us block, movy-host's frame work, and its
 * late frames (a missed SPI transfer is a dropout). Captures are counted for
 * late frames too: a freeze must not drop out while it records.
 *
 * `--thaw N`: unfreeze only the first N tracks (default: all) — what a Set
 * that keeps most of its tracks frozen costs once one or two come back.
 *
 * `--sd-probe`: a control before any freeze — the same window while a file
 * the size of a frozen loop is written to the SD with fsync, nothing frozen.
 * Spikes there are the card's, not the freeze's.
 *
 * `--stop-probe`: a control for the unfreeze's restart — stop, wait as the
 * unfreeze does, play, and measure the same windows, nothing frozen. The
 * render plan is rebuilt when chains wake, with the costs they had asleep,
 * so the first seconds after a play can read high whatever came before.
 *
 * The Set's chain document is read first and written back, the clips are
 * deleted, and the fixture is re-verified; the output is muted throughout. */
import { StandaloneTransport } from '../test-device/dist/transport-standalone.js';
import { Device } from '../test-device/dist/device.js';
import { Probe } from '../test-device/dist/probe.js';
import { setRunMute } from '../test-device/dist/engine.js';
import * as fixture from '../test-device/dist/fixture.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SSH_OPTS } from '../test-device/dist/ssh.js';

const BLOCK_US = 2902;
const DEFAULT = ['obxd', 'surge', 'dexed', 'plaits', 'noisemaker', '8w8', '9w9', 'obxd'];
/* The same traps measure-render-pool.mjs names: presets that make a chord cost a chord. */
const PREPARE = {
    noisemaker: [['preset', '9']], plaits: [['decay', '1']], dexed: [['preset', '12']],
    obxd: [['voice_count', '16']],
};
const CHORD = [60, 64, 67, 71];

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const host = argv.find((a, i, xs) => !a.startsWith('--') && !(xs[i - 1] ?? '').startsWith('--')) ?? 'move.local';
const field = (s, k) => new RegExp(`(?:^| )${k}=(\\S+)`).exec(s)?.[1] ?? '';

async function main() {
    const mods = (opt('modules') ?? DEFAULT.join(',')).split(',');
    fixture.setHost(host);
    const tx = new StandaloneTransport(host);
    const dev = new Device(tx), probe = new Probe(tx);
    await tx.connect();
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe));
    await dev.open(probe);
    await tx.frames(1000);
    const ep = (k, v) => tx.engineSetQueued(k, v);
    const status = () => tx.engineGet('status').catch(() => '');
    const savedChains = await dev.param.get('chains');
    const lastLine = async (prefix) => (await dev.logLines(prefix)).at(-1)?.split(prefix)[1]?.trim() ?? '';
    const waitStatus = async (pred, frames) => {
        for (let i = 0; i < frames / 60; i++) { const s = await status(); if (pred(s)) return s; await tx.frames(60); }
        return status();
    };

    const costWindow = async (label, frames = 1000) => {
        await ep('chcostlog', '1');                    // throws away what came before
        const st0 = await tx.hostBus.state();
        await tx.frames(frames);
        const st = await tx.hostBus.state();
        await ep('chcostlog', '1');
        await tx.frames(20);
        const cost = await lastLine('chain cost:');
        const wall = /\bwall=(\d+)\/(\d+)/.exec(cost);
        const per = (cost.split('cost=')[1] ?? '').split(',').slice(0, mods.length).map((p) => +(Number(p.split('/')[0]) / 1000).toFixed(0));
        const wallUs = wall ? Number(wall[1]) / 1000 : NaN;
        const row = {
            label, frozen: (parseInt(field(await status(), 'frz'), 16) || 0).toString(2).padStart(mods.length, '0').split('').reverse().join(''),
            cpuPct: +(100 * wallUs / BLOCK_US).toFixed(1), wallUs: +wallUs.toFixed(0),
            wallMaxUs: wall ? +(Number(wall[2]) / 1000).toFixed(0) : NaN,
            workAvgUs: st.work_avg_us, workMaxUs: st.work_max_us, late: st.late_frames - st0.late_frames, perChainUs: per,
        };
        console.error(JSON.stringify(row));
        return row;
    };

    const out = { modules: mods, windows: [], captures: [] };
    try {
        for (let c = 0; c < mods.length; c++) {
            const line = `chain ${c}: synth = ${mods[c]}`;
            const before = (await dev.logLines(line)).length;
            await ep(`ch${c}:synth:module`, mods[c]);
            for (let i = 0; i < 60 && (await dev.logLines(line)).length <= before; i++) await tx.frames(60);
            for (const [k, v] of PREPARE[mods[c]] ?? []) await ep(`ch${c}:synth:${k}`, v);
        }
        await tx.frames(700);
        /* A one-bar clip per track: a chord on every other step. */
        const ops = [`bpm ${Number(opt('bpm', '120')) * 100}`];
        for (let c = 0; c < mods.length; c++) {
            ops.push(`clipdel ${c}`);
            for (let s = 0; s < 16; s += 2) ops.push(`tog ${c} ${s} ${CHORD.map((p) => `${p} 100`).join(' ')}`);
        }
        await ep('cmd', ops.join('; '));
        await ep('cmd', 'play');
        await waitStatus((s) => field(s, 'play') === '1', 3000);
        await tx.frames(1000);

        out.windows.push(await costWindow('baseline'));
        const restart = async (label) => {
            await ep('cmd', 'stop');
            await waitStatus((s) => field(s, 'play') === '0', 3000);
            await tx.frames(1500);
            await ep('cmd', 'play');
            await waitStatus((s) => field(s, 'play') === '1', 3000);
            await tx.frames(700);
            out.windows.push(await costWindow(`${label}: 2 s after play`));
            out.windows.push(await costWindow(`${label}: 5 s after play`));
        };
        if (argv.includes('--stop-probe')) await restart('stop/play, nothing frozen');
        if (argv.includes('--sd-probe')) {
            const f = '/data/UserData/movy-sd-probe.bin';
            const dd = promisify(execFile)('ssh', [...SSH_OPTS, `ableton@${host}`,
                `sleep 1; dd if=/dev/urandom of=${f} bs=64k count=32 conv=fsync 2>/dev/null; rm -f ${f}`]);
            out.windows.push(await costWindow('sd write 2 MB + fsync, nothing frozen'));
            await dd;
            out.windows.push(await costWindow('baseline again'));
        }
        for (let c = 0; c < mods.length; c++) {
            const st0 = await tx.hostBus.state(), t0 = Date.now();
            await ep('frz', String(c));
            const s = await waitStatus((x) => (parseInt(field(x, 'frz'), 16) & (1 << c)) && field(x, 'frzc') === '-', 30000);
            const st = await tx.hostBus.state();
            const cap = { track: c, module: mods[c], ok: !!(parseInt(field(s, 'frz'), 16) & (1 << c)),
                          event: field(s, 'frze'), seconds: +((Date.now() - t0) / 1000).toFixed(1),
                          late: st.late_frames - st0.late_frames, workMaxUs: st.work_max_us };
            out.captures.push(cap);
            console.error(JSON.stringify(cap));
            await tx.frames(300);
            out.windows.push(await costWindow(`frozen ${c + 1}/${mods.length} (+${mods[c]})`));
        }
        /* An unfreeze stops the transport first (lib.rs `unfrz`): the reload
         * blocks the audio thread. Say whether it did, then play again so the
         * last window measures the same sounding set as the baseline. */
        const thaw = Math.min(Number(opt('thaw', String(mods.length))), mods.length);
        const keep = ((1 << mods.length) - 1) & ~((1 << thaw) - 1);   // still frozen after
        for (let c = 0; c < thaw; c++) await ep('unfrz', String(c));
        const thawed = await waitStatus((s) => (parseInt(field(s, 'frz'), 16) || 0) === keep, 20000);
        const label = thaw === mods.length ? 'all unfrozen' : `${thaw} unfrozen (${mods.slice(0, thaw).join(', ')})`;
        out.unfreezeStoppedTransport = field(thawed, 'play') === '0';
        console.error(JSON.stringify({ unfreezeStoppedTransport: out.unfreezeStoppedTransport }));
        await tx.frames(1500);                                   // the reloaded chains settle
        await ep('cmd', 'play');
        await waitStatus((s) => field(s, 'play') === '1', 3000);
        await tx.frames(700);
        out.windows.push(await costWindow(`${label}: 2 s after play`));
        out.windows.push(await costWindow(`${label}: 5 s after play`));
    } finally {
        await ep('cmd', 'stop').catch(() => {});
        for (let c = 0; c < mods.length; c++) await ep('unfrz', String(c)).catch(() => {});
        await ep('cmd', mods.map((_, c) => `clipdel ${c}`).join('; ')).catch(() => {});
        await ep('chains', savedChains).catch(() => {});
        await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe)).catch((e) => console.error(`fixture: ${e}`));
        await tx.close();
    }
    return out;
}

setRunMute(true);
console.log(JSON.stringify(await main(), null, 2));
