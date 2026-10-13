#!/usr/bin/env node
/* measure-render-pool.mjs — the render pool on movy-host (WP11): how many
 * lanes, and where the CPU page's edge is. Replaces measure-chain-balance.sh
 * and measure-work-ceiling.sh, which drove the overtake shim.
 *
 *   npm run build:test-device
 *   node scripts/measure-render-pool.mjs lanes   [host] [--lanes 3,4,3,4] [--modules a,b,..] [--assign a,b,..] [--boot frames]
 *   node scripts/measure-render-pool.mjs ceiling [host] [--module surge] [--notes 4] [--max 16]
 *
 * `lanes`: a MIXED set (a real Set is heterogeneous; one module everywhere is
 * the arrangement guaranteed to look balanced) in 12 chains, a chord held in
 * each, then the lane count is switched in the RUNNING engine (`chlanes`) and
 * each arm is measured on the same sounding set. A/B/A/B, so drift shows.
 *
 * `ceiling`: one heavy module, one more chain per step, until movy-host
 * reports late frames (`STATE late_frames`, host/frame_clock.h): a missed SPI
 * transfer is a dropout, measured rather than inferred. The CPU page's bar is
 * `chwall` mean over `blockUs * USABLE_BLOCK`, so the edge is read in the same
 * unit: the render wall's mean at the last clean step.
 *
 * The Set's chain document is read first and written back at the end, then
 * the fixture is re-verified; the output is muted throughout (mute applies
 * after render; costs are inside it). */
import { StandaloneTransport } from '../test-device/dist/transport-standalone.js';
import { Device } from '../test-device/dist/device.js';
import { Probe } from '../test-device/dist/probe.js';
import { setRunMute } from '../test-device/dist/engine.js';
import * as fixture from '../test-device/dist/fixture.js';
import { lpt } from './lib/partition.mjs';

const BLOCK_US = 2902;
const MIXED = ['plaits', 'obxd', 'dexed', 'noisemaker', 'helm', 'forge', 'weird-dreams', 'surge'];
const DRUMS = new Set(['mrdrums', 'weird-dreams', 'forge', 'krautdrums']);
/* Presets and voices that make a held chord cost a chord. Each entry is a
 * trap measured once: plaits' LPG and dexed's presets 0/5 decay a HELD note to
 * silence and read as free; noisemaker 1 and the helm/obxd defaults are
 * monophonic or nearly; the drum kits at 0 are silent init kits. */
const PREPARE = {
    noisemaker: [['preset', '9']], plaits: [['decay', '1']], dexed: [['preset', '12']],
    helm: [['polyphony', '16']], freak: [['polyphony', '16']], obxd: [['voice_count', '16']],
    'weird-dreams': [['kit', '3']], forge: [['kit', '5']],
};

/* Modules that run their DSP on their own thread or process (osirus forks
 * one; minijv runs jv880-emu). Several instances can take the whole box down
 * past recovery (user, 2026-10-13), so at most one each, never in a ramp. */
const OUT_OF_THREAD = new Set(['osirus', 'minijv', 'virus']);

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const host = argv.slice(1).find((a, i, xs) => !a.startsWith('--') && !(xs[i - 1] ?? '').startsWith('--')) ?? 'move.local';
if (mode !== 'lanes' && mode !== 'ceiling') {
    console.error('usage: measure-render-pool.mjs lanes|ceiling [host] [options]');
    process.exit(2);
}

const pitches = (m, n) => {
    const base = DRUMS.has(m) ? [36, 37, 38, 39, 40, 41, 42, 43] : [60, 64, 67, 71, 74, 77, 81, 84];
    return base.slice(0, n);
};

async function main() {
    const asked = mode === 'ceiling' ? [opt('module', 'surge')]
        : opt('assign')?.split(',') ?? (opt('modules') ?? MIXED.join(',')).split(',');
    for (const m of OUT_OF_THREAD) {
        const n = asked.filter((x) => x === m).length;
        if ((mode === 'ceiling' && n) || n > 1 || (mode === 'lanes' && !opt('assign') && n))
            throw new Error(`${m}: at most one instance, named in --assign, never in a ramp`);
    }
    fixture.setHost(host);
    const tx = new StandaloneTransport(host);
    const dev = new Device(tx), probe = new Probe(tx);
    await tx.connect();
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe));
    await dev.open(probe);
    await tx.frames(1000);
    const ep = (k, v) => tx.engineSetQueued(k, v);
    const savedChains = await dev.param.get('chains');
    const held = [];

    /* `chcostlog` logs and resets in one write: the first call throws away the
     * load phase, the second closes the measured window. */
    const lastLine = async (prefix) => (await dev.logLines(prefix)).at(-1)?.split(prefix)[1]?.trim() ?? '';
    const costWindow = async (frames) => {
        await ep('chcostlog', '1');
        const st0 = await tx.hostBus.state(), t0 = Date.now();
        await tx.frames(frames);
        const st = await tx.hostBus.state();
        /* Frames per wall second: a host that keeps the SPI's pace reads
         * 344.5; one that overruns without a long gap shows it here. */
        const rateHz = +((st.frame - st0.frame) / ((Date.now() - t0) / 1000)).toFixed(1);
        await ep('chpeaklog', '1');
        await ep('chcostlog', '1');
        await tx.frames(20);
        const cost = await lastLine('chain cost:');
        const peaks = (await lastLine('chain peaks:')).split(',').map(Number);
        const f = (k) => Number(new RegExp(`\\b${k}=(\\d+)`).exec(cost)?.[1] ?? NaN);
        const wall = /\bwall=(\d+)\/(\d+)/.exec(cost);
        const per = (cost.split('cost=')[1] ?? '').split(',').map((p) => Number(p.split('/')[0]) / 1000);
        return {
            blocks: f('blocks'), wallUs: wall ? Number(wall[1]) / 1000 : NaN, wallMaxUs: wall ? Number(wall[2]) / 1000 : NaN,
            perChainUs: per, peaks, workAvgUs: st.work_avg_us, workMaxUs: st.work_max_us,
            late: st.late_frames - st0.late_frames, pumpMinUs: st.pump_min_us, gapMaxUs: st.gap_max_us, rateHz,
        };
    };
    const load = async (c, m, notes) => {
        const line = `chain ${c}: synth = ${m}`;
        const before = (await dev.logLines(line)).length;
        await ep(`ch${c}:synth:module`, m);
        for (let i = 0; i < 60 && (await dev.logLines(line)).length <= before; i++) await tx.frames(60);
        for (const [k, v] of PREPARE[m] ?? []) await ep(`ch${c}:synth:${k}`, v);
        await tx.frames(100);
        for (const p of pitches(m, notes)) { await ep(`ch${c}:midi`, `144.${p}.100`); held.push([c, p]); }
    };
    const lanesNow = async () => {
        await ep('chrenderlog', '1');
        await tx.frames(20);
        return Number(/\blanes=(\d+)/.exec(await lastLine('chain render:'))?.[1] ?? NaN);
    };
    const lanesBefore = await lanesNow();

    let out;
    try {
        if (mode === 'lanes') {
            const mods = (opt('modules') ?? MIXED.join(',')).split(',');
            const chains = Number(opt('chains', '12'));
            const arms = opt('lanes', '3,4,3,4').split(',').map(Number);
            /* `--assign a,b,..` names every chain, for a set the cycle cannot
             * make (out-of-thread modules beside an even set). */
            const assign = opt('assign')?.split(',') ?? Array.from({ length: chains }, (_, c) => mods[c % mods.length]);
            for (let c = 0; c < assign.length; c++) await load(c, assign[c], 4);
            /* A module with its own DSP thread or process boots after its
             * load returns (osirus: seconds) and is silent until then. */
            await tx.frames(Number(opt('boot', '700')));
            for (let c = 0; c < assign.length; c++)
                for (const p of pitches(assign[c], 4)) await ep(`ch${c}:midi`, `144.${p}.100`);
            out = { mode, lanesBefore, assign, arms: [] };
            for (const lanes of arms) {
                await ep('chlanes', String(lanes));
                await tx.frames(1500);                       // replan + settle, ~4 s
                const w = await costWindow(1000);             // ~3 s: past every held tail
                const sounding = w.peaks.slice(0, assign.length).filter((p) => p > 0).length;
                const items = w.perChainUs.slice(0, assign.length).map((cost, i) => ({ id: i, cost }));
                out.arms.push({ lanes, ...w, sounding, serialUs: items.reduce((t, i) => t + i.cost, 0),
                                lptUs: lpt(items, lanes).makespan, perChainUs: undefined });
            }
            out.perChainUs = (await costWindow(300)).perChainUs.slice(0, assign.length);
        } else {
            const m = opt('module', 'surge'), notes = Number(opt('notes', '4')), max = Number(opt('max', '16'));
            out = { mode, module: m, notes, steps: [] };
            for (let c = 0; c < max; c++) {
                await load(c, m, notes);
                await tx.frames(700);
                const w = await costWindow(2000);             // ~6 s
                out.steps.push({ chains: c + 1, wallUs: w.wallUs, wallMaxUs: w.wallMaxUs,
                                 workAvgUs: w.workAvgUs, workMaxUs: w.workMaxUs, late: w.late, blocks: w.blocks,
                                 wallOfBlock: +(w.wallUs / BLOCK_US).toFixed(3) });
                console.error(JSON.stringify(out.steps.at(-1)));
                if (out.steps.filter((s) => s.late > 0).length >= 2) break;
            }
            const clean = out.steps.filter((s) => s.late === 0).at(-1);
            const first = out.steps.find((s) => s.late > 0);
            out.edge = { lastCleanWallOfBlock: clean?.wallOfBlock ?? null, firstLateWallOfBlock: first?.wallOfBlock ?? null };
        }
    } finally {
        for (const [c, p] of held) await ep(`ch${c}:midi`, `128.${p}.0`).catch(() => {});
        if (Number.isFinite(lanesBefore)) await ep('chlanes', String(lanesBefore)).catch(() => {});
        await ep('chains', savedChains).catch(() => {});
        /* The UI owns the chain document and can re-push the loads made
         * here; only the fixture's own check puts the Set back for sure. */
        await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe)).catch((e) => console.error(`fixture: ${e}`));
        await tx.close();
    }
    return out;
}

setRunMute(true);
console.log(JSON.stringify(await main(), null, 2));
