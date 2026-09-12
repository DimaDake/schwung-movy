/* WORK IN PROGRESS — not wired into run.mjs, not part of the 13-scenario
 * suite. Moved here from `.superpowers/sdd/test-device-migration/seq-wip.ts`
 * 2026-09-12 (followups item 8): that directory is `.gitignore`d wholesale, so
 * a clean clone or fresh worktree had none of this — 851 lines nobody could
 * recover. Tracked here instead, named `.wip.ts` so `build/test-device.mjs`
 * happily transpiles it (harmless — nothing imports it) without it being
 * mistaken for a shipped scenario.
 *
 * Status per test-device/MIGRATION-STATUS.md and
 * plans/2026-09-12-test-device-migration-followups.md item 6: `test-seq.sh`
 * itself is still green and is the trustworthy suite for `seq` in the
 * meantime. What blocks adopting this file is the transport-stop escalation
 * — see item 6's "cheapest path": a local probe now pins the UI-side send
 * (browser-test/logic/seq-engine.mjs), the remaining step is dropping
 * `stopTransport`'s pre-read/poll loop below and re-verifying on device.
 *
 * Migrated from scripts/test-seq.sh — the sequencer end-to-end run.
 *
 * One journey across the surface: step entry, bar/Loop navigation, the
 * transport, punch-in recording, step record (melodic and drum), the Session
 * track selector, the capture overlay's two tempo paths, persistence across a
 * real close, undo/redo, and the Loop+scene song gesture. MIDI goes in through
 * the agent; state comes back from the ENGINE's own params (`status`,
 * `capinfo`) wherever a read exists, from the per-set blob on disk for what
 * only persistence can answer, and from the log for events with no other
 * witness. The bash suite's two infrastructure assertions ("Deployed", "Engine
 * loaded") are not migrated — the harness owns those.
 *
 * Six things the bash could not assert, strengthened here rather than
 * translated:
 *
 *  - Its "reopen" re-issued the open command while movy was still open, so the
 *    JS context re-inited but the ENGINE never unloaded: nothing was restored
 *    from disk, and the `seq: loaded set` line it grepped was the first open's.
 *    This closes through the Leave modal for real, then reads the reopened
 *    engine for the clip THIS run made (track 2's 3-step clip).
 *
 *  - Its autosave check was `find … -size +0c`, which the fixture's own install
 *    satisfies — it could not fail. This asserts this run's edit is IN the blob
 *    (`cl 2 0 3`), a line the fixture never writes.
 *
 *  - Its capture checks keyed on the UI's `seq: capture commit` line alone,
 *    which is written when the button is pressed with something buffered, not
 *    when a take was written. The engine's `capinfo` (mode/cands/why/bpm) and
 *    the clip the take landed in are asserted beside it, and the overdub leg
 *    now asserts what "fitted instead of retempoing" means: the set tempo is
 *    UNCHANGED by the second take.
 *
 *  - Its `grep "undo: "` is satisfied by `undo: dropped no-op 2` and `undo: rec
 *    pass closed at wrap`, both of which the last run wrote — it could pass
 *    with the entry never applied. The entry is named (`… STEP T1 STEP 9`) and
 *    the effect on the engine's occupancy bit is asserted with it.
 *
 *  - Its step-record count was `>= 2` over the whole log with a `seq: steprec
 *    2` anywhere — and the track-2 leg alone (three pads, no arrow) writes
 *    steps 0,1,2. Each leg is its own window here, and the arrow leg must be
 *    exactly [0, 2]: the rest is what proves the arrow moved the head.
 *
 *  - Its boot-gate pump pressed step 18 six times, ~5 of which land after the
 *    gate opens and write a note on whatever track Move had focused. The pool
 *    here is bare Shift taps: the gate refuses ANY input (it sits above
 *    dispatch), so the assertion is identical, while a tap that lands late
 *    cannot sound a note or write a clip.
 *
 * The gestures are otherwise the bash's, in its order, because the run is a
 * journey — each leg's state is what the next one asserts against. Every sleep
 * in it is a wait on the thing it stood in for (the transport's own play byte,
 * the engine's clip length, the count-in, the buffered take), and every wait is
 * a quantity of device frames, never a wall clock.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { cc, noteOn, noteOff, CC_PLAY, CC_REC, CC_UNDO, STEP_NOTE_BASE } from '../midi.js';

const run = promisify(execFile);

/* CCs the bash named inline. Track buttons are deliberately NOT among them:
 * device.selectTrack() owns that mapping and its group-0 assumption. */
const SHIFT_CC   = 49;
const SESSION_CC = 50;
const CAPTURE_CC = 52;
const LOOP_CC    = 58;
const LEFT_CC    = 62;
const RIGHT_CC   = 63;

/* Step buttons are notes 16..31 (src/seq/constants.ts STEP_NOTE_BASE), and the
 * shifted functions are 0-indexed there: 5 = Metronome, 14 = Double Loop. */
const METRO_STEP       = 5;
const DOUBLE_LOOP_STEP = 14;
const STEP = (n: number): number => STEP_NOTE_BASE + n;

const PAD = 70;        // the one pad every bash leg proves
const DRUM_ANCHOR = STEP(0);   // the held step of the drum multi-entry gesture
const DRUM_TAP    = STEP(4);   // the step tapped inside the hold

/* Frames to let movy act on a gesture before reading — a quantity of device
 * work, never a wall clock (dev: ~2.9 ms/frame). */
const ACT = 90;

/* A BUTTON press, in frames: the bash's tap helper holds every button 50 ms
 * (`ts_send "…:127:0.05" "…:0"`), while device.ts's tap holds 2. A press the
 * transport button has a whole UI tick to see is the difference between a
 * stop and nothing at all. */
const PRESS = 10;

const LOG = '/data/UserData/schwung/debug.log';

/* The undo/redo entry this run makes on step 9 of track 0, named rather than
 * "any undo:" — the same log carries `undo: dropped no-op 2` and `undo: rec
 * pass closed at wrap`, which is how the bash's `grep "undo: "` could pass with
 * the entry never applied. */
const UNDO9 = /undo: (ADD|CLEAR) STEP T1 STEP 9\s*$/;
const REDO9 = /redo: (ADD|CLEAR) STEP T1 STEP 9\s*$/;

/* The capture phrase's spacing IS the input: the estimator reads onsets. The
 * bash played pads 0.25 s apart on the free leg (→ ~240 BPM, whose half/double
 * readings give the candidate list) and 0.30 s apart on the overdub leg, from a
 * device-side python script. Same periods, in frames. */
const LEG1_PERIOD = 86;   // 0.249 s
const LEG1_HOLD   = 20;   // 0.058 s
const LEG2_PERIOD = 103;  // 0.299 s
const LEG2_HOLD   = 17;   // 0.049 s

/* ── Log reads ────────────────────────────────────────────────────────────────
 *
 * One ssh per poll, filtered to the shadow copy (every line is written twice —
 * `[shadow]` and the move shim — so a delta of one event is meaningful).
 * debug.log persists across runs, so the window below is opened by clearing it
 * before this run's first open, and every later window is a delta against a
 * count taken before its gesture. */
const LOG_RE = '\\[shadow\\].*(seq: input refused during|seq: play=|seq: steprec '
             + '|seq: step |seq: capture |seq: loaded set|seq: set ready|undo: |redo: )';

const said = (ok: boolean, evidence: string, why: string): string => (ok ? evidence : why);

/* A field out of a `key=value` line. The leading separator keeps `t=` from
 * matching inside `set=`, and NaN (never 0) says the field was missing rather
 * than that it read as a plausible zero. */
const raw = (line: string, name: string): string =>
    (line.match(new RegExp('(?:^| )' + name + '=([^ ]*)')) ?? [])[1] ?? '';
const num = (line: string, name: string): number => {
    const v = raw(line, name);
    return v === '' ? NaN : Number(v);
};

/* `occ` is 256 bits as 64 hex chars, step 0 = the MSB of the first byte. */
const occBit = (line: string, step: number): number => {
    const hex = raw(line, 'occ');
    const byte = parseInt(hex.slice(2 * (step >> 3), 2 * (step >> 3) + 2), 16);
    return Number.isNaN(byte) ? -1 : (byte >> (7 - (step & 7))) & 1;
};
const occBits = (line: string): number[] => {
    const out: number[] = [];
    for (let s = 0; s < 64; s++) if (occBit(line, s) === 1) out.push(s);
    return out;
};

/* A field out of a SPACE-separated line — `seq: step 4 lane 36` (router-steps.ts)
 * rather than the engine's `key=value`. Reading those with raw() asks for
 * `step=` and gets NaN for both fields, which compares as "not 0, not equal" and
 * turns a landed gesture into a silent null. */
const word = (line: string, name: string): number => {
    const m = line.match(new RegExp('(?:^| )' + name + ' (\\d+)'));
    return m ? Number(m[1]) : NaN;
};
const capPending = (line: string): number => {
    const v = raw(line, 'cap');
    return v === '' ? NaN : Number(v.split('.')[0]);
};

scenario('seq', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* ── Reads ────────────────────────────────────────────────────────────────
     * `status` is the engine's whole sequencer state in one param: the watched
     * track's clip, its occupancy, the transport, the capture buffer. The UI
     * mirrors it, but the mirror is written optimistically and the local suites
     * already cover it — what only a device can show is that the ENGINE holds
     * it. */
    const status = async (): Promise<string> => {
        try { return await dev.param.get('overtake_dsp:status'); } catch { return ''; }
    };
    const capinfo = async (): Promise<string> => {
        try { return await dev.param.get('overtake_dsp:capinfo'); } catch { return ''; }
    };
    const waitStatus = async (what: string, pred: (s: string) => boolean,
                               within = 700, every = 30): Promise<string> =>
        until(t.bus, what, status, pred, { within, every }).catch(() => status());

    /* The per-set blob, read out of band — no param and no ViewModel exposes the
     * file, and it is the only place "did this survive" or "is this on disk"
     * can be answered. */
    let setsDir = '';
    const seqDisk = async (): Promise<string> => {
        if (setsDir === '') {
            const uuid = await fixture.activeUuid().catch(() => '');
            setsDir = `/data/UserData/schwung/modules/tools/movy/sets/${uuid || '_default'}`;
        }
        try {
            const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes',
                `ableton@${t.host}`, `cat '${setsDir}/seq-state.json' 2>/dev/null || true`],
                { maxBuffer: 4 * 1024 * 1024 });
            return stdout;
        } catch { return ''; }
    };
    const waitDisk = async (what: string, re: RegExp, within: number): Promise<string> => {
        let blob = '';
        try {
            blob = await until(t.bus, what, seqDisk, (b) => re.test(b),
                { within, every: 400 });
        } catch { blob = await seqDisk(); }
        return blob;
    };

    const logEvents = async (): Promise<string[]> => {
        try {
            const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes',
                `ableton@${t.host}`, `grep -E '${LOG_RE}' ${LOG} 2>/dev/null || true`],
                { maxBuffer: 8 * 1024 * 1024 });
            return stdout.split('\n').filter(Boolean);
        } catch { return []; }
    };
    const mark = async (): Promise<number> => (await logEvents()).length;
    const lines = async (before: number): Promise<string[]> => (await logEvents()).slice(before);

    /* Let movy act, bounded by frames, then read. The log write happens on the
     * gesture's own tick, so the first read often already has it. */
    const settle = async (before: number, pred: (ls: string[]) => boolean,
                          what: string, within = 1500): Promise<string[]> => {
        try {
            const all = await until(t.bus, what, logEvents,
                (ls) => pred(ls.slice(before)), { within, every: 150 });
            return all.slice(before);
        } catch { return lines(before); }
    };
    const hits = (ls: string[], needle: string): string[] => ls.filter((l) => l.includes(needle));
    const last = (ls: string[]): string => (ls.length ? ls[ls.length - 1] : '');

    /* ── Gestures ─────────────────────────────────────────────────────────────
     * Every combined gesture is a real press/body/release (device.ts hold
     * family): a press and a release delivered as two separate events is a
     * different gesture to movy, which is what the bash's one-round-trip helper
     * existed to avoid. */
    const sessionStep = (n: number) => dev.holdCc(SESSION_CC, () => dev.tap.note(STEP(n), 127));
    /* Select a track AND make the ENGINE agree, which is not the same thing.
     *
     * The watched track is pushed to the engine by COMPARISON — `watch <n>` goes
     * out when the UI's own mirror changes — so a push lost on the way leaves
     * the mirror on `n` and the engine on something else, and every further press
     * of that button is a no-op: the mirror never changes again, so nothing is
     * ever re-sent. Stepping to a neighbour and back changes the mirror twice,
     * which re-arms the push. The ack is the engine's (`trk=`), so this retries
     * on the engine's answer and never on a timer. */
    const goTrack = async (n: number): Promise<number> => {
        await dev.selectTrack(n);
        let s = await waitStatus(`track ${n} to be watched`, (x) => num(x, 'trk') === n, 700);
        if (num(s, 'trk') !== n) {
            const via = n === 3 ? 2 : n + 1;   // any other button of the same group
            await dev.selectTrack(via);
            await t.bus.frames(ACT);
            await dev.selectTrack(n);
            s = await waitStatus(`track ${n} to be watched (second press)`,
                (x) => num(x, 'trk') === n, 700);
        }
        const got = num(s, 'trk');
        if (got !== n) t.note(`trackMiss_t${n}`, s || '<no status>');
        return got;
    };

    /* The transport, read rather than toggled blindly. The bash's captures
     * depend on "the transport is stopped" (that is the path that detects a
     * tempo) and it got there by tapping Play and assuming which parity it
     * started from — an assumption that only held because the Session leg
     * before it had launched a clip.
     *
     * Two things the bash's tap had that dev.tap.cc does not: a 50 ms hold
     * (`ts_tap_cc` = `ts_send "…:127:0.05" "…:0"`, i.e. a press a `Stop` has a
     * whole tick to observe), and no one else touching the params at that
     * moment. So the press is held, and every attempt re-reads the ENGINE's own
     * play byte first: a tap sent blind against a stale byte is a tap that can
     * start the transport instead of stopping it. A `stop` op lost on the way
     * (the param channel coalesces, so a batch sharing an audio buffer with
     * another write is dropped) is then simply retried. */
    const stopTransport = async (what: string): Promise<void> => {
        let s = await status();
        if (Number.isNaN(num(s, 'play'))) {
            s = await waitStatus(`${what}: a readable play byte`,
                (x) => !Number.isNaN(num(x, 'play')), 300);
        }
        let tries = 0;
        while (num(s, 'play') === 1 && tries < 3) {
            tries++;
            await dev.holdCc(CC_PLAY, () => t.bus.frames(PRESS));
            s = await waitStatus(`the transport to be stopped for ${what} (press ${tries})`,
                (x) => num(x, 'play') === 0, 300);
        }
        t.note('transportStop_' + what, `presses=${tries} play=${num(s, 'play')}`);
        if (num(s, 'play') !== 0) t.note('transportNotStopped', `${what}: ${s || '<no status>'}`);
    };

    /* A phrase: one pad, evenly spaced. Ten onsets on the free leg because the
     * surface drops some of a fast stream and the estimator needs three; one
     * pad because a melodic layout leaves gaps where a pad plays nothing, and a
     * take of pads that never sounded has no onsets to measure. */
    const phrase = async (n: number, period: number, hold: number): Promise<void> => {
        for (let i = 0; i < n; i++) {
            await t.agent.inject(noteOn(PAD, 110));
            await t.bus.frames(hold);
            await t.agent.inject(noteOff(PAD));
            await t.bus.frames(period - hold);
        }
    };

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();

    /* The log is cleared so every window below belongs to THIS run — the once
     * per boot "input refused" line in particular, which would otherwise be
     * found in any earlier run's leavings. */
    try {
        await run('ssh', ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', `ableton@${t.host}`,
            `touch /data/UserData/schwung/debug_log_on; : > ${LOG}`]);
    } catch { /* the windows below stay deltas even so */ }

    /* ── 1. The boot gate ─────────────────────────────────────────────────────
     *
     * A press arriving while movy is still booting or loading the Set must be
     * REFUSED, not queued: before the gate it was buffered and flushed on the
     * very tick a blank state landed on top of it, which is how a new Set lost
     * its first pattern. The window is ~130 ms wide (init → "set ready"), so
     * the press is pumped rather than fired once; whichever lands inside it is
     * the one that counts.
     *
     * Pads or step buttons would work equally well — the gate is above every
     * dispatch path, and its own log line is the assertion either way. Bare
     * Shift taps are used because a press that lands AFTER the gate opens is
     * then a no-op: the bash's step presses entered notes on the focused track,
     * and steps 2/3/9 are this same suite's fixtures for other checks. */
    const gateFrom = await mark();
    const opening = open();                    // issues the open command after one ssh
    let gateLine = '';
    /* Taps FIRST, log read second: open() spends an ssh before it issues the
     * command, so a read-first loop would waste the window it is trying to hit
     * on the round trip. Tapping from t=0 covers it — before the tool exists the
     * taps are dropped, and the ones that matter are the ones already in flight
     * when the boot starts. */
    for (let round = 0; round < 10 && gateLine === ''; round++) {
        for (let i = 0; i < 24; i++) {          // ~0.3 s of taps
            await t.agent.inject(cc(SHIFT_CC, 127));
            await t.bus.frames(1);
            await t.agent.inject(cc(SHIFT_CC, 0));
            await t.bus.frames(1);
        }
        const ls = await logEvents();
        gateLine = ls.find((l) => l.includes('seq: input refused during')) ?? '';
        if (gateLine !== '' || ls.some((l) => l.includes('seq: set ready'))) break;
    }
    await opening;                              // movy is live, or nothing below holds
    const gatePhase = (gateLine.match(/input refused during ([a-z]+)/) ?? [])[1] ?? '';
    const okGate = gateLine !== '';
    t.note('bootGateLine', gateLine || '(none)');
    t.check('boot-gate-refused', 'the boot gate refused input', okGate, {
        expected: 'a "seq: input refused during <phase>" line from this boot',
        actual: said(okGate, `refused during ${gatePhase} — ${gateLine}`,
            'no press landed inside the boot window: the gate is unproven either way '
            + '(a refusal is the only witness, an absent note is also what a press that '
            + 'never arrived looks like)'),
    });
    const gateWindow = await lines(gateFrom);
    t.note('bootWindowEvents', gateWindow.length);

    /* ── 2. Step entry, bar/Loop navigation ───────────────────────────────────
     * Movy opens on whatever track Move had focused, so the run says which one
     * it is on rather than inheriting it — the fixture owns the clips, not
     * Move's selection. */
    await goTrack(0);
    await t.bus.frames(ACT);

    await dev.tap.note(80, 100);                // sets the step-entry pitch
    await t.bus.frames(ACT);
    await dev.tap.note(STEP(0), 127);           // step 1 — a note on track 0
    await t.bus.frames(ACT);
    /* Chord: two pads held, one step press. */
    await dev.hold(82, async () => {
        await t.agent.inject(noteOn(84, 100));
        try { await dev.tap.note(STEP(4), 127); }
        finally { await t.agent.inject(noteOff(84)); }
    });
    await t.bus.frames(ACT);
    await dev.tap.cc(RIGHT_CC);                 // bar navigation
    await dev.tap.cc(LEFT_CC);
    await t.bus.frames(ACT);
    /* Loop mode: latch, set a bar, double-tap for a 1-bar loop, unlatch. The
     * double tap is interval-bounded only (loop-mode.ts, ≤450 ms), so two taps
     * back to back are one. */
    await dev.tap.cc(LOOP_CC);
    await dev.tap.note(STEP(0), 127);
    await dev.tap.note(STEP(0), 127);
    await dev.tap.cc(LOOP_CC);
    await t.bus.frames(ACT);
    await dev.holdCc(SHIFT_CC, () => dev.tap.note(STEP(DOUBLE_LOOP_STEP), 127));
    await t.bus.frames(ACT);

    /* ── 3. The transport, and the absence of it before now ───────────────────
     * `seq: play=` is the engine's own play byte, edge-logged by the status
     * poll (engine.ts) — so "no play=1 before the Play press" is a statement
     * about the engine's transport, not about the UI's mirror. */
    const prePlay = await lines(gateFrom);
    const autoStarted = hits(prePlay, 'seq: play=1');
    t.check('step-entry-no-autostart',
        'step entry did not auto-start the transport (Play is what starts it)',
        autoStarted.length === 0, {
            expected: 'no "seq: play=1" between the boot and the Play press',
            actual: said(autoStarted.length === 0,
                `none in ${prePlay.length} log events of step entry, chords and Loop navigation`,
                `${autoStarted.length} transport start(s) before Play: ${autoStarted[0]}`),
        });

    const beforePlay = await mark();
    await dev.tap.cc(CC_PLAY);
    const played = await waitStatus('Play to start the transport',
        (s) => num(s, 'play') === 1, 700);
    const playLines = await settle(beforePlay, (ls) => hits(ls, 'seq: play=1').length > 0,
        'the transport start to be logged', 700);
    const okPlay = num(played, 'play') === 1 && hits(playLines, 'seq: play=1').length > 0;
    t.check('play-starts-transport', 'the Play button started the transport', okPlay, {
        expected: 'engine play=1 and a "seq: play=1" line',
        actual: said(okPlay, `engine play=${num(played, 'play')} and ${last(hits(playLines, 'seq: play=1'))}`,
            `engine play=${num(played, 'play')}, ${hits(playLines, 'seq: play=1').length} play=1 line(s)`),
    });

    /* ── 4. Punch-in recording ────────────────────────────────────────────────
     * Rec from stopped starts the transport and a 1-bar count-in; the take is
     * what is played after it, not during it. No check keys on this leg — it is
     * here because the recording path is real surface, and because the clip it
     * grows is what the later capture legs land beside. */
    await dev.holdCc(SHIFT_CC, () => dev.tap.note(STEP(METRO_STEP), 127));   // metronome on
    await t.bus.frames(ACT);
    await dev.tap.cc(CC_REC);
    /* The count-in only exists off a STOPPED transport (toggle_record seeds it
     * with count_in_left when it starts the transport itself). Punching into a
     * running clip arms immediately, so this waits for the count-in only if the
     * engine says there is one — either way the pad is played once the take is
     * armed, which is what the bash's fixed 2.5 s was standing in for. */
    const armed = await waitStatus('Rec to arm the take',
        (s) => num(s, 'rec') === 1 || num(s, 'cin') === 1, 400);
    if (num(armed, 'cin') === 1) {
        await waitStatus('the count-in to elapse into recording',
            (s) => num(s, 'cin') === 0 && num(s, 'rec') === 1, 1400);
    }
    await dev.tap.note(PAD, 110);
    await t.bus.frames(ACT);
    await dev.tap.cc(CC_REC);                    // Rec again stops the take
    await waitStatus('the take to close', (s) => num(s, 'rec') === 0 && num(s, 'cin') === 0, 400);

    await stopTransport('step record');
    t.note('afterRecordingLeg', await status());

    /* ── 5. Step record — the rest must MOVE the head ─────────────────────────
     * One hand-rolled gesture per leg: Rec held across the whole thing (a Rec
     * press and release delivered separately is the arm/stop tap, not the
     * hold), a pad, an arrow, another pad. The bash asserted a count over the
     * whole log with `seq: steprec 2` somewhere — the track-2 leg below writes
     * steps 0,1,2 on its own, so that check could pass with the arrow doing
     * nothing at all. This leg is exact: [0, 2]. */
    const legA = await mark();
    await dev.holdCc(CC_REC, async () => {
        await dev.tap.note(PAD, 110);
        await dev.tap.cc(RIGHT_CC);              // a rest: the head advances
        await dev.tap.note(PAD + 1, 110);
    });
    await t.bus.frames(ACT);
    const legALines = await settle(legA, (ls) => hits(ls, 'seq: steprec ').length >= 2,
        'both step-record entries to be logged');
    const legASteps = hits(legALines, 'seq: steprec ').map((l) => word(l, 'steprec'));
    const okRest = legASteps.length === 2 && legASteps[0] === 0 && legASteps[1] === 2;
    t.note('steprecLegA', legASteps);
    t.check('steprec-rest-advanced',
        'step record entered both notes and the Right arrow moved the head over the rest',
        okRest, {
            expected: 'exactly two entries on steps [0, 2]',
            actual: said(okRest, `steps ${JSON.stringify(legASteps)}`,
                legASteps.length !== 2
                    ? `${legASteps.length} step-record entr(ies): ${JSON.stringify(legASteps)} — `
                      + 'the gesture did not land as a Rec hold'
                    : `steps ${JSON.stringify(legASteps)} — the rest did not advance the head, `
                      + 'so the second note stacked on the first'),
        });

    /* ── 6. An empty clip grows PER STEP ──────────────────────────────────────
     * The fixture leaves tracks 2 and 3 without clips, so this is the only
     * place the grow-per-step path runs on device (track 0's clip is 16 steps
     * and takes the wrap path). A 16 here means the engine's bar rounding won.
     * Read from the engine — `len` is the clip the sequencer will play — and
     * again from the blob under check 10, which is the half that persists. */
    await goTrack(2);
    const legB = await mark();
    await dev.holdCc(CC_REC, async () => {
        await dev.tap.note(PAD, 110);
        await dev.tap.note(PAD + 1, 110);
        await dev.tap.note(PAD + 2, 110);
    });
    const grews = await waitStatus('track 2 to hold a 3-step clip',
        (s) => num(s, 'trk') === 2 && num(s, 'len') === 3
            && [0, 1, 2].every((b) => occBit(s, b) === 1)
            && occBits(s).length === 3, 900);
    const legBLines = await lines(legB);
    const legBSteps = hits(legBLines, 'seq: steprec ').map((l) => word(l, 'steprec'));
    const okGrew = num(grews, 'len') === 3 && occBits(grews).join(',') === '0,1,2';
    t.note('steprecLegB', legBSteps);
    t.note('track2Clip', grews || '<no status>');
    t.check('empty-clip-grew', 'an empty clip grew to exactly 3 steps, not a rounded-up bar',
        okGrew, {
            expected: 'engine len=3 with occupancy bits 0,1,2',
            actual: said(okGrew, `len=${num(grews, 'len')} occ bits [${occBits(grews)}] after ${legBSteps.length} entries`,
                `len=${num(grews, 'len')} occ bits [${occBits(grews)}] — a 16 here is the `
                + 'engine bar-rounding a deliberately 3-step clip'),
        });
    await goTrack(0);

    /* ── 7. Hold Session + step retargets the SEQUENCER, not just the screen ──
     * The regression: the Session step row moved appState.activeTrack (screen,
     * pads, knobs) but never seqState.watchTrack, and the engine re-pinned
     * watchTrack from `trk=` on every status poll — so the step row and every
     * step edit stayed on the track you came from. Track 9 because nothing else
     * in this suite writes there, and because the bug is specifically about
     * tracks past the first group. */
    await sessionStep(9);
    await t.bus.frames(ACT);
    const trk9 = await waitStatus('the Session step row to move the watched track',
        (s) => num(s, 'trk') === 9, 700);
    await dev.tap.note(STEP(0), 110);            // the step edit must follow it
    const on9 = await waitStatus('the note to land on track 9',
        (s) => num(s, 'trk') === 9 && num(s, 'len') === 16 && occBit(s, 0) === 1, 700);
    const okRetarget = num(trk9, 'trk') === 9 && num(on9, 'len') === 16 && occBit(on9, 0) === 1;
    t.note('track9Clip', on9 || '<no status>');
    t.check('session-step-retarget',
        'held Session + step retargeted the sequencer — the note landed on track 9',
        okRetarget, {
            expected: 'engine trk=9 with a 16-step clip there, note on step 1',
            actual: said(okRetarget, `trk=${num(on9, 'trk')} len=${num(on9, 'len')} occ bits [${occBits(on9)}]`,
                `trk=${num(trk9, 'trk')} after the gesture, clip len=${num(on9, 'len')} `
                + `occ bits [${occBits(on9)}] — the edit did not follow the selector`),
        });
    /* Back to track 0 through the same gesture: the track buttons address the
     * FOCUSED group, which selecting track 9 moved to group 2. */
    await sessionStep(0);
    await t.bus.frames(ACT);
    await waitStatus('the selector to bring track 0 back', (s) => num(s, 'trk') === 0, 700);

    /* ── 8. Session mode: launch a clip, stop a slot ──────────────────────────*/
    await dev.tap.cc(SESSION_CC);
    await t.bus.frames(ACT);
    await dev.tap.note(92, 127);                 // top-left clip pad = track 0 slot 0
    await t.bus.frames(ACT);
    await dev.tap.note(68, 127);                 // bottom-left = track 3 slot 0 (empty)
    await t.bus.frames(ACT);
    await dev.tap.cc(SESSION_CC);
    await t.bus.frames(ACT);

    /* ── 9. Drum multi-entry: hold one step, tap another ──────────────────────
     * Track 1 is the fixture's drum module, so watchLane >= 0 and the drum
     * branch of toggleStep logs each entry with its lane. The bash counted
     * `seq: step ` lines over the whole log with `>= 2`; here the window is the
     * gesture and the lanes must agree, because two entries on two different
     * lanes is what a half-armed gesture looks like. */
    await goTrack(1);
    const drumFrom = await mark();
    await dev.hold(DRUM_ANCHOR, () => dev.tap.note(DRUM_TAP, 127));
    await t.bus.frames(ACT);
    const drumLines = await settle(drumFrom, (ls) => hits(ls, 'seq: step ').length >= 2,
        'both drum steps to be entered');
    const drum = hits(drumLines, 'seq: step ')
        .map((l) => ({ step: word(l, 'step'), lane: word(l, 'lane') }));
    const drumSteps = drum.map((d) => d.step).sort((a, b) => a - b);
    const drumLanes = drum.map((d) => d.lane);
    const okDrum = drum.length === 2 && drumSteps.join(',') === '0,4'
        && drumLanes[0] === drumLanes[1] && drumLanes[0] >= 0;
    t.note('drumEntries', drum);
    t.check('drum-multi-step', 'the drum multi-step gesture entered both steps while one was held',
        okDrum, {
            expected: 'exactly two entries on steps 0 and 4, on one lane',
            actual: said(okDrum, `${drum.length} entries: ${JSON.stringify(drum)}`,
                drum.length !== 2
                    ? `${drum.length} entries: ${JSON.stringify(drum)}`
                    : `entries ${JSON.stringify(drum)} — expected steps 0 and 4 on the same lane`),
        });

    /* ── 10. Capture, free tempo: an EMPTY clip ───────────────────────────────
     * Track 3 is the one track nothing else in this suite writes to, so it is
     * the only place the free-tempo path runs: with an empty clip movy owns the
     * tempo, so the take sets it and the overlay offers the candidates. The
     * transport must be STOPPED for that path at all (capture_commit_stopped
     * is what sets cap_mode). */
    await goTrack(3);
    await stopTransport('the free-tempo capture');
    await phrase(10, LEG1_PERIOD, LEG1_HOLD);
    const buffered1 = await waitStatus('the take to be buffered',
        (s) => capPending(s) >= 3, 500);
    const pending1 = capPending(buffered1);
    const leg1 = await mark();
    await dev.tap.cc(CAPTURE_CC);
    const rolled1 = await waitStatus('the take to land in the clip',
        (s) => num(s, 'trk') === 3 && num(s, 'len') > 0 && occBit(s, 0) === 1, 900);
    let info1 = '';
    try {
        info1 = await until(t.bus, 'the tempo overlay to open', capinfo,
            (i) => raw(i, 'mode') !== 'none', { within: 900, every: 60 });
    } catch { info1 = await capinfo(); }
    const leg1Lines = await lines(leg1);
    const commit1 = last(hits(leg1Lines, 'seq: capture commit'));
    const select1 = last(hits(leg1Lines, 'seq: capture select'));
    /* The clip must hold a PHRASE, not a note: `capture commit` is written on
     * the button press with anything buffered, so the log line alone says the
     * buffer was non-empty, not that a take was written into the clip. */
    const took1 = occBits(rolled1).length;
    const wrote1 = num(rolled1, 'len') > 0 && occBit(rolled1, 0) === 1 && took1 >= 3;
    const okCommit = /seq: capture commit trk=3 n=\d+/.test(commit1) && wrote1;
    t.note('captureLeg1', { pending: pending1, commit: commit1, select: select1, info: info1 });
    t.check('capture-commit', 'Capture committed the buffered phrase into the clip', okCommit, {
        expected: 'a commit of track 3 with something buffered, and the phrase in the clip',
        actual: said(okCommit,
            `${commit1} → engine len=${num(rolled1, 'len')} with ${took1} occupied steps `
            + `[${occBits(rolled1)}]`,
            pending1 < 3 || !Number.isFinite(pending1)
                ? `nothing was buffered (cap pending=${pending1}) — the pads did not reach the take`
                : commit1 === ''
                    ? 'the Capture press committed nothing'
                    : num(rolled1, 'len') === 0
                        ? `${commit1} but track 3's clip is still empty`
                        : `${commit1} but the clip holds ${took1} step(s) `
                          + `[${occBits(rolled1)}] — a phrase was played, not a single note`),
    });
    /* The tempo overlay is modal: any press dismisses it (the bash's Shift).
     * Dismissed before the next leg reads, or the next capture's own overlay
     * would be the one being asserted. */
    await dev.tap.cc(SHIFT_CC);
    await t.bus.frames(ACT);

    /* ── 11. Capture, fixed tempo: a clip that already has notes ──────────────
     * The set tempo is not up for grabs: the take is fitted to it and the
     * overlay explains rather than offers. `why=notes` is the engine's reason,
     * and the tempo the second take reports must be the one the FIRST leg left
     * — "fitted instead of retempoing" is exactly that equality. */
    await goTrack(0);
    await stopTransport('the fixed-tempo capture');
    /* `status` carries centibpm (bpm_x100) and `capinfo` whole BPM — the same
     * tempo in two units, so the comparison normalizes rather than compares. */
    const bpmBefore = Math.round(num(await status(), 'bpm') / 100);
    await phrase(4, LEG2_PERIOD, LEG2_HOLD);
    const buffered2 = await waitStatus('the second take to be buffered',
        (s) => capPending(s) >= 3, 500);
    const leg2 = await mark();
    await dev.tap.cc(CAPTURE_CC);
    let info2 = '';
    try {
        info2 = await until(t.bus, 'the fitted overlay to open', capinfo,
            (i) => raw(i, 'mode') === 'fix', { within: 900, every: 60 });
    } catch { info2 = await capinfo(); }
    const leg2Lines = await lines(leg2);
    const commit2 = last(hits(leg2Lines, 'seq: capture commit'));
    const fixed2 = last(hits(leg2Lines, 'seq: capture fixed'));
    const bpmAfter = num(info2, 'bpm');
    const okFixed = raw(info2, 'mode') === 'fix' && raw(info2, 'why') === 'notes'
        && /seq: capture fixed bpm=\d+ bars=\d+ why=notes/.test(fixed2)
        && bpmAfter === bpmBefore;
    t.note('setTempo', `${bpmBefore} → ${bpmAfter}`);
    t.note('captureLeg2', { pending: capPending(buffered2), commit: commit2, fixed: fixed2, info: info2 });
    t.check('capture-fixed-notes', 'a clip with notes was fitted to the set tempo instead of retempoing',
        okFixed, {
            expected: `capinfo mode=fix why=notes at the unchanged bpm=${bpmBefore}, `
                    + 'with a "seq: capture fixed … why=notes" line',
            actual: said(okFixed, `${fixed2}; capinfo ${info2}; tempo ${bpmBefore} → ${bpmAfter}`,
                raw(info2, 'mode') !== 'fix'
                    ? `capinfo "${info2}" — the engine did not take the fixed-tempo path `
                      + `(${commit2})`
                    : raw(info2, 'why') !== 'notes'
                        ? `capinfo "${info2}" — why should be notes: the clip it landed in has them`
                        : fixed2 === ''
                            ? 'the engine took the fixed path but movy never reported it'
                            : `the take retempoed the Set: ${bpmBefore} → ${bpmAfter}`),
        });

    /* An EMPTY clip is the case where movy owns the tempo, so the overlay DEFERS
     * to the user: it must offer the candidates it detected, not apply one. */
    const cands = raw(info1, 'cands').split(',').filter((c) => Number(c) > 0);
    const okSelect = raw(info1, 'mode') === 'sel' && cands.length >= 2
        && /seq: capture select bpm=\d+ bars=\d+/.test(select1);
    t.note('captureSelectCands', cands);
    t.check('capture-select-tempo', 'an empty clip: capture detected a tempo and offered it', okSelect, {
        expected: 'capinfo mode=sel with at least two candidates, '
                + 'and a "seq: capture select bpm=… bars=…" line',
        actual: said(okSelect, `${select1}; the engine offered ${cands.join('/')} BPM`,
            raw(info1, 'mode') !== 'sel'
                ? `capinfo "${info1}" — the empty-clip take did not open the selector`
                : cands.length < 2
                    ? `one candidate (${cands.join('/')}) is not a choice — the take's onsets were not read`
                    : `the selector opened but movy never logged it: "${select1}"`),
    });
    await dev.tap.cc(SHIFT_CC);                 // dismiss the fixed overlay
    await t.bus.frames(ACT);
    await stopTransport('the persistence wait');

    /* ── 12. Autosave put this run's edit on disk ─────────────────────────────
     * The bash asked whether ANY non-empty blob existed — which the fixture's
     * own install satisfies, so it could not fail. `cl 2` is a clip only this
     * run writes, and only movy's own save can put it there. The wait is on the
     * write (SAVE_TICKS is tick-based: ~8 s at this device's rate, not the ~3 s
     * the source comments assume), so it is a wait, not a sleep. */
    const blob = await waitDisk('the per-set blob to carry this run\'s clip 2', /^cl 2 0 3 /m, 6000);
    const okSave = /^cl 2 0 3 /m.test(blob);
    t.note('blobHasClip2', okSave);
    t.check('autosave-wrote-state', 'the autosave wrote this run\'s edit into the per-set state', okSave, {
        expected: '"cl 2 0 3 " in sets/<uuid>/seq-state.json',
        actual: said(okSave,
            `the blob carries the 3-step clip this run entered on track 2 (${blob.length} bytes)`,
            blob === '' ? `no seq-state.json under ${setsDir}`
                : 'the blob on disk still has the fixture\'s clips only — the autosave did not '
                  + 'write this run\'s edit (or wrote a stale copy)'),
    });

    /* ── 13. A REAL reopen restores it ────────────────────────────────────────
     * Close through the Leave modal (Back is not a close button), then open
     * again and read the ENGINE for the clip the run made. The bash re-issued
     * the open command while movy was still loaded: the JS context re-inited,
     * the engine never unloaded, and nothing was restored. */
    const beforeReopen = await mark();
    await close();
    await open();
    const reopenLines = await lines(beforeReopen);
    const loadedSet = hits(reopenLines, 'seq: loaded set');
    await goTrack(2);
    const restored = await waitStatus('the reopened engine to hold the run\'s track-2 clip',
        (s) => num(s, 'trk') === 2 && num(s, 'len') === 3
            && [0, 1, 2].every((b) => occBit(s, b) === 1)
            && occBits(s).length === 3, 900);
    const okLoaded = loadedSet.length > 0 && num(restored, 'len') === 3
        && [0, 1, 2].every((b) => occBit(restored, b) === 1);
    t.note('reopenLoadedSet', loadedSet.length);
    t.note('reopenedTrack2', restored || '<no status>');
    t.check('set-loaded-on-reopen', 'the Set state loaded on a real reopen — the run\'s clip came back', okLoaded, {
        expected: 'a fresh "seq: loaded set" and, on track 2, len=3 with bits 0,1,2',
        actual: said(okLoaded,
            `${loadedSet.length} load(s); track 2 came back as len=${num(restored, 'len')} `
            + `occ bits [${occBits(restored)}]`,
            loadedSet.length === 0
                ? 'the reopen never loaded a Set'
                : `the Set loaded but track 2 came back as len=${num(restored, 'len')} `
                  + `occ bits [${occBits(restored)}] — the clip this run made is not what was restored`),
    });

    /* ── 14. Undo and redo, on the entry the run just made ────────────────────
     * CC 56 is one of the buttons schwung's overtake owns, and the local suites
     * drive the router directly rather than through the shim — the button
     * reaching movy at all is the part only the device can prove. But `undo:`
     * is not that proof on its own: the previous run's log carries `undo:
     * dropped no-op 2` and `undo: rec pass closed at wrap`. The entry is named,
     * and the engine's occupancy bit is asserted to move with it. */
    await goTrack(0);
    const occBefore = occBit(await status(), 8);
    const undoFrom = await mark();
    await dev.tap.note(STEP(8), 127);            // step 9 — a step the run left alone
    const toggled = await waitStatus('the step edit to reach the engine',
        (s) => occBit(s, 8) !== occBefore, 700);
    t.note('step9Before', occBefore);
    t.note('step9AfterTap', occBit(toggled, 8));
    await t.bus.frames(ACT);
    await dev.tap.cc(CC_UNDO);
    const undoLines = await settle(undoFrom, (ls) => ls.some((l) => UNDO9.test(l)),
        'the undo of this step to be logged');
    const undoEntry = undoLines.find((l) => UNDO9.test(l)) ?? '';
    const afterUndo = await waitStatus('the engine to take the undo',
        (s) => occBit(s, 8) === occBefore, 700);
    const okUndo = UNDO9.test(undoEntry) && occBit(afterUndo, 8) === occBefore;
    t.note('undoEntry', undoEntry);
    t.check('undo-applied', 'Undo (CC 56) reached movy and put the step back', okUndo, {
        expected: 'an "undo: … STEP T1 STEP 9" entry and occupancy bit 8 back at '
                + `${occBefore}`,
        actual: said(okUndo, `${undoEntry}; engine step 9 back to ${occBefore}`,
            undoEntry === '' || !/STEP T1 STEP 9$/.test(undoEntry)
                ? `"${undoEntry}" is not this run's step entry — the button either did not `
                  + 'reach movy or applied something else'
                : `${undoEntry} was applied but the engine still shows step 9 = ${occBit(afterUndo, 8)}`),
    });

    const redoFrom = await mark();
    await dev.holdCc(SHIFT_CC, () => dev.tap.cc(CC_UNDO));   // Shift+Undo = redo
    const redoLines = await settle(redoFrom, (ls) => ls.some((l) => REDO9.test(l)),
        'the redo of this step to be logged');
    const redoEntry = redoLines.find((l) => REDO9.test(l)) ?? '';
    const afterRedo = await waitStatus('the engine to take the redo',
        (s) => occBit(s, 8) !== occBefore, 700);
    const okRedo = REDO9.test(redoEntry) && occBit(afterRedo, 8) !== occBefore;
    t.note('redoEntry', redoEntry);
    t.check('redo-applied', 'Shift+Undo redid that entry', okRedo, {
        expected: `a "redo: … STEP T1 STEP 9" entry and step 9 toggled back off ${occBefore}`,
        actual: said(okRedo, `${redoEntry}; engine step 9 = ${occBit(afterRedo, 8)}`,
            redoEntry === '' || !/STEP T1 STEP 9$/.test(redoEntry)
                ? `"${redoEntry}" is not this run's step entry`
                : `${redoEntry} was re-applied but the engine still shows step 9 = ${occBit(afterRedo, 8)}`),
    });

    /* ── 15. Nothing bypassed undo ────────────────────────────────────────────
     * An un-grouped edit means some gesture mutates the Set without recording
     * an undo entry, and an unclassified verb means one passed through the
     * recorder without being understood. Local suites assert the first for the
     * gestures they drive; a full device run exercises far more of the surface.
     * Both are the same guard's two failure modes, so both are counted here. */
    const whole = await lines(gateFrom);
    const ungrouped = hits(whole, 'undo: ungrouped');
    const unclassified = hits(whole, 'undo: unclassified verb');
    const okGuard = ungrouped.length === 0 && unclassified.length === 0;
    t.note('ungroupedEdits', ungrouped.length);
    t.note('unclassifiedVerbs', unclassified.length);
    t.check('no-ungrouped-edits', 'no edit bypassed undo during the whole run', okGuard, {
        expected: 'no "undo: ungrouped" and no "undo: unclassified verb" in the run',
        actual: said(okGuard,
            `none in ${whole.length} events — every gesture from boot to undo recorded an entry`,
            `${ungrouped.length + unclassified.length} edit(s) bypassed the undo recorder: `
            + `${(ungrouped[0] ?? unclassified[0] ?? '')}`),
    });

    /* ── 16. The song, built and saved with the Set ───────────────────────────
     * Loop + the odd step buttons in Session view are the eight scenes; the
     * first press of a Loop hold starts a song and later ones extend it, so the
     * whole thing is ONE gesture (a Loop hold across two taps). Asserted on the
     * engine's own scene list AND the persisted blob: `sg` is the whole round
     * trip — gesture → UI → engine → the Set on disk — and it is the only part
     * of song mode the local suites cannot reach. The playhead (`song_pos`) is
     * deliberately not pinned: it is where the song was left, not what was
     * built. */
    await dev.tap.cc(SESSION_CC);
    await t.bus.frames(ACT);
    await dev.holdCc(LOOP_CC, async () => {
        await dev.tap.note(STEP(0), 127);
        await dev.tap.note(STEP(2), 127);
    });
    const songEngine = await waitStatus('the engine to hold the song',
        (s) => /^\d+:0,1$/.test(raw(s, 'song')), 700);
    const songBlob = await waitDisk('the song to reach the Set on disk', /^sg 0 1$/m, 6000);
    const okSong = /^\d+:0,1$/.test(raw(songEngine, 'song')) && /^sg 0 1$/m.test(songBlob);
    t.note('songEngine', raw(songEngine, 'song'));
    t.note('songOnDisk', /^sg 0 1$/m.test(songBlob));
    t.check('song-built-saved', 'the song built from Loop + scenes was saved with the Set', okSong, {
        expected: 'engine song=<pos>:0,1 and "sg 0 1" in the per-set blob',
        actual: said(okSong, `engine song=${raw(songEngine, 'song')}, blob sg 0 1`,
            !/^\d+:0,1$/.test(raw(songEngine, 'song'))
                ? `the engine holds song="${raw(songEngine, 'song')}" — the Loop+scene gesture `
                  + 'did not build a two-scene song'
                : 'the engine built the song but the Set on disk has no "sg 0 1" line'),
    });

    /* Leave the surface in Note view, where a user would find it. The Set's own
     * state needs no teardown: fixture.ensure() reseeds both halves from disk at
     * the start of every scenario. */
    await dev.tap.cc(SESSION_CC);
    await t.bus.frames(ACT);
});
