/* Freeze on the device (plans/2026-11-08-freeze-all-clips-design.md;
 * site/manual/sounds.md). The menu, the guards, the waveform and the pads are
 * pinned in browser-test/logic/freeze*.mjs and the bank and the swap in the
 * cargo tests; what only the box can show is the whole loop through a real
 * chain, the audio thread and the Set's files.
 *
 * Covers:
 *   Z1 Shift + track button opens the menu, and nothing is recorded before the click
 *   Z2 the jog click records every clip (two here) and freezes the track (stopped)
 *   Z2b the screen follows the capture's progress (the toast is redrawn as it moves)
 *   Z3 the transport started for the capture is stopped again
 *   Z4 the frozen track's chain is unloaded; the other tracks' chains are not
 *   Z5 with the transport running the loop is what the track plays (peak > 0)
 *   Z5b a launch of the other clip plays that clip's own loop
 *   Z5c a Loop-mode cut of a frozen clip is taken, a grow past it refused
 *   Z6 the Set keeps it: a reopen comes back frozen, a WAV per clip on disk
 *   Z7 Unfreeze while playing: the first click only arms, the second stops the
 *      transport, reloads the chain and deletes the WAVs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { CC_PLAY, CC_DELETE, CC_TRACK_BASE, STEP_NOTE_BASE, PAD_NOTE_BASE } from '../midi.js';
import { SSH_OPTS } from '../ssh.js';
import { Display } from '../display.js';

const run = promisify(execFile);
const CC_SHIFT = 49;
const T1_BUTTON = CC_TRACK_BASE + 3;   // 43 = track 1
const ACT = 90;

const field = (s: string, k: string) => s.match(new RegExp(`(?:^| )${k}=(\\S+)`))?.[1] ?? '';
const frozenBit0 = (s: string) => (parseInt(field(s, 'frz'), 16) & 1) === 1;

scenario('freeze', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const open = () => dev.open(probe);
    const close = () => dev.close(probe);
    const status = () => t.tx.engineGet('status').catch(() => '');
    const ssh = async (cmd: string) =>
        (await run('ssh', [...SSH_OPTS, `ableton@${t.host}`, cmd])).stdout.trim();
    const setDir = fixture.movySetDir();
    const wait = async <T>(what: string, read: () => Promise<T>, pred: (v: T) => boolean, within: number) => {
        try { return await until(t.tx, what, read, pred, { within, every: 150 }); } catch { return read(); }
    };
    const menuT1 = () => dev.holdCc(CC_SHIFT, async () => {
        await dev.tap.cc(T1_BUTTON);
    });
    const loaded = async () => (await fixture.chloaded(t.tx)) ?? '';
    const synth0 = fixture.fixtureSynth(0);

    await fixture.ensure(t.tx, open, close);
    await dev.deployUi();
    await open();
    /* Whatever happens below, the fixture's track 0 comes back as a chain. */
    t.need.register(async () => {
        if (frozenBit0(await status())) await t.tx.engineSet('unfrz', '0');
    });

    /* A one-bar clip with notes on track 0, the transport stopped. */
    await dev.selectTrack(0);
    if (field(await status(), 'play') === '1') await dev.tap.cc(CC_PLAY);
    await dev.tap.note(PAD_NOTE_BASE, 100);
    await dev.tap.cc(CC_DELETE);
    await t.tx.frames(ACT);
    for (const s of [0, 4, 8, 12]) { await dev.tap.note(STEP_NOTE_BASE + s, 127); await t.tx.frames(ACT); }
    /* Slot 0 two bars long (a cut needs room), and a second clip in slot 1. */
    await t.tx.engineSet('cmd', 'clen 0 32;clipsel 0 1;tog 0 0 64 100;tog 0 8 67 100;clipsel 0 0');
    await t.tx.frames(ACT);

    // ── Z1: the menu asks first ─────────────────────────────────────────────
    await menuT1();
    await t.tx.frames(ACT);
    const s1 = await status();
    t.check('z1-asks-first', 'Shift + track opens the menu; nothing records before the click',
        field(s1, 'frzc') === '-' && !frozenBit0(s1), { expected: 'frzc=- frz bit0 clear', actual: s1 });

    // ── Z2: confirm → two passes → frozen ───────────────────────────────────
    await dev.tap.jog();
    const started = await wait('the capture to start', status, (s) => field(s, 'frzc').startsWith('0:') || frozenBit0(s), 3000);
    t.note('captureStart', `frzc=${field(started, 'frzc')} play=${field(started, 'play')}`);
    /* The toast band (rows 58-63: framebuffer page 7), sampled while the
     * capture runs. One drawing of "FREEZING T1 0%" left on screen until the
     * end reads as one distinct band; a screen that follows reads several. */
    const display = new Display(t.tx);
    const bands = new Set<string>();
    const pcts: string[] = [];
    for (let i = 0; i < 6; i++) {
        const fb = await display.grab().catch(() => null);
        if (fb) bands.add(fb.subarray(7 * 128, 8 * 128).toString('hex'));
        pcts.push(field(await status(), 'frzc'));
        await t.tx.frames(100);
    }
    t.check('z2b-progress-redrawn', "the screen follows the capture's progress, not just its first value",
        bands.size >= 2, { expected: '>= 2 distinct toast bands over 6 samples', actual: `${bands.size} distinct; frzc ${pcts.join(' ')}` });
    const s2 = await wait('track 0 to freeze', status, (s) => frozenBit0(s) && field(s, 'frzc') === '-', 40000);
    t.check('z2-frozen', 'the jog click recorded both clips and froze T1',
        frozenBit0(s2) && field(s2, 'frzc') === '-' && field(s2, 'frze').endsWith(':0:frozen'),
        { expected: 'frz bit0, frzc=-, frze=<n>:0:frozen', actual: `frz=${field(s2, 'frz')} frzc=${field(s2, 'frzc')} frze=${field(s2, 'frze')}` });

    // ── Z3: the transport it started is stopped again ───────────────────────
    const s3 = await wait('the transport to stop', status, (s) => field(s, 'play') === '0', 3000);
    t.check('z3-transport-back', 'the transport started for the capture is stopped again',
        field(s3, 'play') === '0', { expected: 'play=0', actual: `play=${field(s3, 'play')}` });

    // ── Z4: T1's chain unloaded, the others untouched ───────────────────────
    const l4 = await loaded();
    t.note('chloadedFrozen', l4);
    const othersOk = fixture.chainEntries().filter((e) => e.track !== '0')
        .every((e) => l4.includes(`${e.track}:${e.comp}=${e.mod}`) && !l4.includes(`${e.track}:${e.comp}=${e.mod}?`));
    t.check('z4-unloaded', "the frozen track's chain is unloaded, every other chain is still loaded",
        l4.includes(`0:synth=${synth0}?`) && othersOk,
        { expected: `0:synth=${synth0}? and the rest without ?`, actual: l4 });

    // ── Z5: the loop plays in its place ─────────────────────────────────────
    await dev.tap.cc(CC_PLAY);
    await wait('the transport to start', status, (s) => field(s, 'play') === '1', 3000);
    await t.tx.frames(400);
    const before = (await t.tx.logGrep('chain peaks:')).length;
    await t.tx.engineSetQueued('chpeaklog', '1');
    const peaks = await wait('chpeaklog', () => t.tx.logGrep('chain peaks:'), (ls) => ls.length > before, 3500);
    const p0 = Number((peaks[peaks.length - 1] ?? '').split('chain peaks:')[1]?.trim().split(',')[0] ?? 0);
    t.check('z5-loop-plays', 'with the transport running the frozen loop sounds on T1',
        p0 > 0, { expected: 'T1 peak > 0', actual: peaks[peaks.length - 1] ?? '<no line>' });

    // ── Z5b: the other clip plays its own loop ──────────────────────────────
    await t.tx.engineSet('cmd', 'launch 0 1');
    const s5b = await wait('slot 1 to play', status, () => true, 100);
    await t.tx.frames(1200);   // past the bar the launch waits for
    const before5b = (await t.tx.logGrep('chain peaks:')).length;
    await t.tx.engineSetQueued('chpeaklog', '1');
    const peaks5b = await wait('chpeaklog', () => t.tx.logGrep('chain peaks:'), (ls) => ls.length > before5b, 3500);
    const p5b = Number((peaks5b[peaks5b.length - 1] ?? '').split('chain peaks:')[1]?.trim().split(',')[0] ?? 0);
    t.check('z5b-other-clip', "a launch of slot 1 plays slot 1's loop on the frozen track",
        p5b > 0, { expected: 'T1 peak > 0 on slot 1', actual: `${peaks5b[peaks5b.length - 1] ?? '<no line>'} ${field(s5b, 'frz')}` });
    await dev.tap.cc(CC_PLAY);
    await wait('the transport to stop', status, (s) => field(s, 'play') === '0', 3000);
    /* The launch selected slot 1; the cut below is slot 0's. */
    await t.tx.engineSet('cmd', 'clipsel 0 0');
    await t.tx.frames(ACT);

    // ── Z5c: a Loop-mode cut is taken, a grow refused ───────────────────────
    const frzr = (s: string) => field(s, 'frzr');
    const r0 = frzr(await status());
    await t.tx.engineSet('cmd', 'loop 0 16 16');
    await t.tx.frames(ACT);
    const c1 = await status();
    await t.tx.engineSet('cmd', 'clen 0 32');
    await t.tx.frames(ACT);
    const c2 = await status();
    t.check('z5c-loop-cut', 'a cut inside the recording is taken; a window past it is refused',
        frzr(c1) === r0 && field(c1, 'lstart') === '16' && frzr(c2) !== r0 && field(c2, 'len') === '16',
        { expected: `frzr unchanged then moved; lstart=16 len=16`, actual: `frzr ${r0}->${frzr(c1)}->${frzr(c2)} lstart=${field(c2, 'lstart')} len=${field(c2, 'len')}` });
    await t.tx.engineSet('cmd', 'loop 0 0 32');
    await t.tx.frames(ACT);

    // ── Z6: the Set keeps it ────────────────────────────────────────────────
    const files = await wait('the freeze files', () => ssh(
        `test -s '${setDir}/freeze/t0-s0.wav' && test -s '${setDir}/freeze/t0-s1.wav' && echo wav; grep -c . '${setDir}/freeze.txt' 2>/dev/null || true`),
        (v) => v.startsWith('wav'), 5000);
    await close();
    await open();
    const s6 = await wait('the reopened Set to report T1 frozen', status, frozenBit0, 5000);
    t.check('z6-persists', 'a reopen comes back frozen, the WAV and manifest on disk',
        files.startsWith('wav') && frozenBit0(s6) && field(s6, 'frzm').startsWith('0:'),
        { expected: 'freeze/t0-s0.wav + t0-s1.wav, frz bit0, frzm=0:<module>', actual: `files=[${files.replace(/\n/g, ' ')}] frz=${field(s6, 'frz')} frzm=${field(s6, 'frzm')}` });

    // ── Z7: Unfreeze while playing ──────────────────────────────────────────
    await dev.selectTrack(0);
    await t.tx.frames(ACT);
    await dev.tap.cc(CC_PLAY);
    const playing7 = field(await wait('the transport to start', status, (s) => field(s, 'play') === '1', 3000), 'play') === '1';
    await menuT1();
    await t.tx.frames(ACT);
    await dev.tap.jog();
    await t.tx.frames(ACT);
    const a7 = await status();
    t.check('z7-arms', 'unfreeze while playing: the first click only arms (still frozen, still playing)',
        playing7 && frozenBit0(a7) && field(a7, 'play') === '1',
        { expected: 'play=1, frz bit0', actual: `play=${field(a7, 'play')} frz=${field(a7, 'frz')}` });
    await dev.tap.jog();
    const s7 = await wait('T1 to thaw', status, (s) => !frozenBit0(s), 8000);
    t.check('z7-stops', 'the second click stopped the transport before the reload',
        field(s7, 'play') === '0', { expected: 'play=0', actual: `play=${field(s7, 'play')}` });
    const l7 = await wait('T1 chain to be back', loaded, (l) => l.includes(`0:synth=${synth0}`) && !l.includes(`0:synth=${synth0}?`), 8000);
    const wav = await wait('the WAVs to go', () => ssh(`ls '${setDir}/freeze/'t0-*.wav >/dev/null 2>&1 && echo still || echo gone`), (v) => v === 'gone', 5000);
    t.check('z7-unfreeze', 'Unfreeze reloads the chain and deletes the WAVs',
        !frozenBit0(s7) && l7.includes(`0:synth=${synth0}`) && !l7.includes(`0:synth=${synth0}?`) && wav === 'gone',
        { expected: `frz bit0 clear, 0:synth=${synth0}, t0-*.wav gone`, actual: `frz=${field(s7, 'frz')} ${l7} wav=${wav}` });

});
