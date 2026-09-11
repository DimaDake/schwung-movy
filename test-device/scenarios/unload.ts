/* Migrated from scripts/test-unload.sh — closing movy mid-playback must
 * release every sounding note.
 *
 * The bash suite asserted on a UI log line ('[movy] seq: play=1') for the
 * transport check; the engine's own `status` is ground truth and already
 * exposes `play=`, so this reads that instead. The release count has no
 * ViewModel to read (the DSP is torn down as it happens), so that one check
 * stays a log grep, out of band over SSH — same shape as `dev.open()`'s own
 * restore-ready wait.
 *
 * Covers:
 *   U1  the transport is actually running before close (a precondition —
 *       a teardown with nothing open would prove nothing)
 *   U2  onUnload fires on a real Close Movy
 *   U3  it releases more than zero gates
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { CC_PLAY, CC_DELETE, STEP_NOTE_BASE, PAD_NOTE_BASE } from '../midi.js';
import { until } from '../wait.js';

const PAD = PAD_NOTE_BASE;   // default focused pad — sets the step-entry pitch

/* Frames to let movy act on a gesture before reading — a quantity of device
 * work, never a wall clock. */
const ACT = 90;
/* One note on one step is silent for most of a 16-step loop, so a teardown
 * sampled at a random moment would find no open gate and prove nothing — the
 * bash suite filled all 16 steps and let the transport run for ~3s of real
 * time before closing. This is that same wait expressed as device frames
 * (~2.9ms each) rather than a wall-clock sleep. */
const LOOP_SETTLE = 1050;

scenario('unload', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    await fixture.ensure(t.bus, open, close);
    await dev.open(probe);
    await dev.selectTrack(0);

    await dev.tap.note(PAD, 100);                 // set the step-entry pitch
    // Clear whatever clip a previous run (or an earlier suite) left, so all 16
    // presses below are additive and the clip is exactly one bar — otherwise a
    // step press TOGGLES and a long, sparse clip leaves the playhead outside
    // the filled bar for most of the loop.
    await dev.tap.cc(CC_DELETE);
    await t.bus.frames(ACT);
    for (let s = STEP_NOTE_BASE; s < STEP_NOTE_BASE + 16; s++) {
        await dev.tap.note(s, 127);
        await t.bus.frames(ACT);
    }

    await dev.tap.cc(CC_PLAY);
    let playing = true;
    try {
        await until(t.bus, 'the transport to start',
            () => t.bus.getParam('overtake_dsp:status'),
            (s) => /(^| )play=1( |$)/.test(s), { within: 3000, every: 60 });
    } catch { playing = false; }
    t.check('u1-transport', 'the transport started (gates can be open at teardown)', playing);

    // Let the clip loop for real so gates are open at teardown, not merely
    // requested to be.
    await t.bus.frames(LOOP_SETTLE);

    const before = (await dev.logLines('unload: released')).length;
    await dev.close(probe);

    let lines: string[] = [];
    try {
        lines = await until(t.bus, 'movy to log the unload release',
            () => dev.logLines('unload: released'),
            (ls) => ls.length > before, { within: 3000, every: 150 });
    } catch { lines = await dev.logLines('unload: released'); }
    t.note('unloadLines', lines);

    const fired = lines.length > before;
    t.check('u2-fired', 'onUnload fired on Close Movy', fired);

    const n = fired ? Number(lines[lines.length - 1].match(/released (\d+)/)?.[1] ?? 0) : 0;
    t.note('released', n);
    t.check('u3-released', 'it released more than zero gates', n > 0,
        { expected: '>0', actual: String(n) });

    // Left closed on purpose: that IS the scenario, and fixture.ensure() on the
    // next scenario opens movy itself regardless of how this one left it.
});
