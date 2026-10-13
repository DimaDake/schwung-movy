#!/usr/bin/env node
/* measure-ui-ipc.mjs — the UI/engine cost on movy-host, the fixture Set
 * PLAYING: the WP7 T6 measurement (compare-flavours.mjs, deleted with the
 * overtake flavour in WP9) on the one host left, kept for WP10's before/after.
 *
 * Run AFTER a device tier (the fixture is then in place):
 *   npm run build:test-device && node scripts/measure-ui-ipc.mjs [host] [--trials 20]
 *
 * - tick rate, perf_refresh_ms, perf_ipc: movy's own perf lines, medians over
 *   a settled window;
 * - engine render wall / peak per block (`chwall`) and the master stage inside
 *   it (`mfxcost`);
 * - movy-host's whole audio-thread frame work (STATE work_avg/max_us);
 * - pad to sound, timed by the ENGINE (`padlat`, pad_latency.rs), in blocks.
 * Muted throughout: mute is applied after render, and chpeak inside it. */
import { StandaloneTransport } from '../test-device/dist/transport-standalone.js';
import { Device } from '../test-device/dist/device.js';
import { Probe } from '../test-device/dist/probe.js';
import { setRunMute } from '../test-device/dist/engine.js';
import * as fixture from '../test-device/dist/fixture.js';
import { CC_PLAY } from '../test-device/dist/midi.js';

const args = process.argv.slice(2);
const ti = args.indexOf('--trials');
const TRIALS = ti >= 0 ? Number(args[ti + 1]) : 20;
const host = args.find((a, i) => !a.startsWith('--') && i !== ti + 1) ?? 'move.local';
const PAD = 68;   // pad 1, on track 1

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const nums = (lines, key) => lines.map((l) => Number(new RegExp(`\\b${key}=([0-9.]+)`).exec(l)?.[1])).filter(Number.isFinite);

async function measure(tx) {
    fixture.setHost(host);
    const dev = new Device(tx), probe = new Probe(tx);
    await tx.connect();
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe));
    await dev.open(probe);
    await dev.selectTrack(0);
    await tx.frames(2000);                                       // settle, ~6 s

    const count = async (p) => (await dev.logLines(p)).length;
    const before = { tick: await count('perf_tick_rate='), refresh: await count('perf_refresh_ms='),
                     ipc: await count('perf_ipc calls/tick=') };
    /* chwall's peak is HELD from the instance's first block, and a movy-host
     * open is a fresh process with cold caches after every chain load. The
     * steady state is what is measured, so start the held peak here, as the
     * CPU page does when it opens. */
    /* Under the same musical load: the fixture's clips, playing. A silent Set
     * puts every chain to sleep, and an idle comparison only measures which
     * fixed stages each host runs (standalone's master stage, for one). */
    await dev.tap.cc(CC_PLAY);
    await tx.frames(700);
    await dev.param.set('cpurst', '1');
    const walls = [], peaks = [], masters = [], workAvg = [], workMax = [];
    for (let i = 0; i < 40; i++) {                               // ~12 s of samples
        await tx.frames(100);
        const st = await dev.param.get('status').catch(() => '');
        const cw = /\bchwall=([0-9.]+)\/([0-9.]+)/.exec(st);
        if (cw) { walls.push(Number(cw[1])); peaks.push(Number(cw[2])); }
        /* The master stage renders inside chwall; chains-only is the number
         * the WP7 table compared. */
        const mc = /\bmfxcost=([0-9.]+)\//.exec(st);
        masters.push(mc ? Number(mc[1]) : 0);
        if (i % 10 === 9) {
            const s = await tx.hostBus.state();
            if (s.work_avg_us) { workAvg.push(s.work_avg_us); workMax.push(s.work_max_us); }
        }
    }
    const playing = /\bplay=1\b/.test(await dev.param.get('status').catch(() => ''));
    await dev.tap.cc(CC_PLAY);
    const tick = nums((await dev.logLines('perf_tick_rate=')).slice(before.tick), 'perf_tick_rate');
    const refresh = nums((await dev.logLines('perf_refresh_ms=')).slice(before.refresh), 'perf_refresh_ms');
    const ipc = (await dev.logLines('perf_ipc calls/tick=')).slice(before.ipc);

    /* Engine-side (pad_latency.rs): both hosts call on_midi before the
     * frame's render, so the same block counter times both. */
    await dev.param.set('padlat', '0');
    for (let i = 0; i < TRIALS; i++) {
        await tx.frames(60);                                     // the last note's tail is gone
        await tx.dspMidi([0x09, 0x90, PAD, 110]);
        await tx.frames(40);
        await tx.dspMidi([0x08, 0x80, PAD, 0]);
    }
    const pl = await dev.param.get('padlat').catch(() => '');
    const plNum = (k) => Number(new RegExp(`\\b${k}=(\\d+)`).exec(pl)?.[1] ?? NaN);
    const row = {
        playing,
        tickHz: median(tick), refreshMs: median(refresh),
        ipcMs: median(nums(ipc, 'ipc_ms')), tickMs: median(nums(ipc, 'tick_ms')), periodMs: median(nums(ipc, 'period_ms')),
        renderWallUs: median(walls), renderPeakUs: peaks.length ? Math.max(...peaks) : NaN,
        masterUs: median(masters), chainsWallUs: median(walls.map((w, i) => w - (masters[i] ?? 0))),
        frameWorkAvgUs: workAvg.length ? median(workAvg) : null, frameWorkMaxUs: workMax.length ? Math.max(...workMax) : null,
        padBlocks: plNum('med'), padBlocksMax: plNum('max'), padTrials: `${plNum('n')}/${TRIALS}`,
        samples: { tick: tick.length, refresh: refresh.length, ipc: ipc.length, wall: walls.length },
    };
    await tx.close();
    return row;
}

setRunMute(true);
console.log(JSON.stringify(await measure(new StandaloneTransport(host)), null, 2));
