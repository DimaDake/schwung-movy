/* New with WP7 — movy-host's own test bus, and the debugging surface it
 * carries (plan WP7 T2 + T4). Standalone only: schwung-testd has none of these
 * verbs, so beside Move the runner prints N/A.
 *
 * What only the device can show: the log ring really is the one path every
 * thread's lines take (the UI's console.log and the engine's host log land in
 * it, and in debug.log, none dropped); the midi_out tap sees what reached the
 * SPI out mailbox; UI_EVAL runs in the live UI; a JS throw in a handler ends
 * the session WITH its stack; and a native crash leaves a backtrace. The
 * protocol shapes are pinned in host/tests/test_log.c.
 *
 * Covers:
 *   B1 LOG_SEQ / LOG_TAIL: 200 UI lines in one burst, every one in the ring
 *      and in debug.log, in order
 *   B2 the engine's lines share the ring (one writer, so nothing contends)
 *   B3 UI_EVAL answers JSON, awaits a promise, and returns a throw's stack
 *   B4 midi_out: a UI send reaches the tap with the frame it left on
 *   B5 a throw in a UI handler logs its stack and ends the session; the
 *      harness hold brings movy back without Move
 *   B6 a native crash (dev-only CRASH verb) leaves a backtrace in debug.log
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { noteOn } from '../midi.js';

const TAG = `tbprobe-${process.pid}`;
const BURST = 200;

scenario('testbus', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const hb = t.tx.hostBus!;
    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);

    // ── B1: the UI's lines, all of them ─────────────────────────────────────
    const base = await hb.logSeq();
    const logBefore = (await dev.logLines(`${TAG} ui `)).length;
    await hb.uiEval(`for (let i = 0; i < ${BURST}; i++) console.log('[movy] ${TAG} ui ' + i); 0`);
    let tail = await hb.logTail(base, `${TAG} ui `);
    const seqs = tail.lines.map((l) => Number(/ ui (\d+)$/.exec(l.text)?.[1]));
    t.check('log-ring', `all ${BURST} UI lines are in the ring, in order`,
        seqs.length === BURST && seqs.every((n, i) => n === i) && tail.lost === 0,
        { expected: `${BURST} lines, 0..${BURST - 1}`, actual: `${seqs.length} lines, lost=${tail.lost}, first ${seqs.slice(0, 3)}` });
    let onDisk = 0;
    try {
        onDisk = (await until(t.tx, 'the writer to reach debug.log', () => dev.logLines(`${TAG} ui `),
            (ls) => ls.length - logBefore >= BURST, { within: 3000, every: 200 })).length - logBefore;
    } catch (e: any) { onDisk = Array.isArray(e?.last) ? e.last.length - logBefore : -1; }
    t.check('log-disk', `and all ${BURST} reached debug.log through the one writer`,
        onDisk === BURST, { expected: `${BURST}`, actual: `${onDisk}` });

    // ── B2: the engine's lines share the ring ───────────────────────────────
    const eBase = await hb.logSeq();
    await t.tx.engineSet('mfxlog', '1');
    try {
        tail = await until(t.tx, 'the engine line in the ring', () => hb.logTail(eBase, '[movy-dsp]'),
            (v) => v.lines.length > 0, { within: 2000, every: 100 });
    } catch { tail = await hb.logTail(eBase, '[movy-dsp]'); }
    t.check('log-engine', 'an engine (audio-thread) line lands in the same ring',
        tail.lines.length > 0, { expected: 'a [movy-dsp] line after mfxlog', actual: tail.lines[0]?.text ?? '(none)' });

    // ── B3: UI_EVAL ─────────────────────────────────────────────────────────
    const v = await hb.uiEval(`({ host: typeof movy_host, sum: 40 + 2 })`) as any;
    const p = await hb.uiEval(`Promise.resolve(41).then((x) => x + 1)`);
    let threw = '';
    try { await hb.uiEval(`(function tbThrow() { throw new Error('${TAG} eval') })()`); } catch (e: any) { threw = String(e?.message ?? e); }
    t.check('ui-eval', 'UI_EVAL answers JSON, awaits a promise, and returns a throw with its stack',
        v?.sum === 42 && v?.host !== 'undefined' && p === 42 && threw.includes(`${TAG} eval`) && threw.includes('tbThrow'),
        { expected: 'sum=42, host defined, promise=42, ERR naming tbThrow', actual: JSON.stringify({ v, p, threw: threw.slice(0, 160) }) });

    // ── B4: the midi_out tap ────────────────────────────────────────────────
    /* Pad 31's LED, set and cleared from the UI's own send path: what the tap
     * shows is what left on SPI, not what JS asked for. */
    await hb.subscribeMidiOut();
    const f0 = await t.tx.frames(1);
    await hb.uiEval(`move_midi_internal_send([0x09, 0x90, 99, 5]); move_midi_internal_send([0x09, 0x90, 99, 0]); 0`);
    await t.tx.frames(10);
    const evs = await hb.dumpMidiOut();
    const pad = evs.filter((e) => e.bytes[1] === 0x90 && e.bytes[2] === 99);
    t.note('midiOut', { total: evs.length, pad });
    t.check('midi-out-tap', 'a UI LED send reaches the midi_out tap, framed after it was sent',
        pad.length >= 1 && pad.every((e) => e.frame > f0) && pad[pad.length - 1].bytes[3] === 0,
        { expected: 'note 99 on the tap after frame ' + f0 + ', last velocity 0 (last writer wins)',
          actual: JSON.stringify(pad) });

    // ── B5: a JS throw in a handler ─────────────────────────────────────────
    const pidOf = async () => /pid=(\d+)/.exec(await t.tx.ping().catch(() => ''))?.[1] ?? '';
    const pid = await pidOf();
    const exBefore = (await dev.logLines('EXCEPTION in onMidiMessageInternal')).length;
    await hb.uiEval(`globalThis.move_midi_internal_send = function tbSend() { throw new Error('${TAG} handler') }; 0`);
    await t.tx.uiMidi(noteOn(68, 100));   // a pad press lights its LED: the patched send throws
    await t.tx.uiMidi(noteOn(68, 0));
    let exLines: string[] = [];
    try {
        exLines = await until(t.tx, 'the handler exception in debug.log',
            () => dev.logLines('EXCEPTION in onMidiMessageInternal'), (ls) => ls.length > exBefore, { within: 3000, every: 200 });
    } catch { /* checked below */ }
    const stack = (await dev.logLines(`${TAG} handler`)).join('\n');
    t.check('js-stack', 'a throw in a UI handler logs its stack and ends the session',
        exLines.length > exBefore && stack.includes(`${TAG} handler`) && !(await t.tx.running()),
        { expected: 'EXCEPTION in onMidiMessageInternal with the message, movy closed', actual: stack.slice(0, 200) || '(no exception line)' });
    await dev.open(probe);
    const pid2 = await pidOf();
    t.check('js-stack-relaunch', 'and the harness hold relaunched a fresh movy-host without Move',
        !!pid2 && pid2 !== pid, { expected: `a pid other than ${pid}`, actual: pid2 || '(none)' });

    // ── B6: a native crash ──────────────────────────────────────────────────
    const crBefore = (await dev.logLines('CRASH SIGSEGV')).length;
    await hb.crash();
    let crash: string[] = [];
    try {
        crash = await until(t.tx, 'the crash backtrace in debug.log', () => dev.logLines('CRASH SIGSEGV'),
            (ls) => ls.length > crBefore, { within: 5000, every: 250 });
    } catch { /* checked below */ }
    /* -rdynamic (build-host.sh) is what puts names on the frames; the CRASH
     * verb faults inside testbus_handle, so the trace must say so. */
    const trace = await dev.logLines('movy-host(testbus_handle+');
    t.note('crash', { line: crash[crash.length - 1], frame: trace[trace.length - 1] });
    t.check('crash-backtrace', 'a native crash leaves a backtrace, with function names, in debug.log',
        crash.length > crBefore && trace.length > 0,
        { expected: 'a CRASH SIGSEGV line and a movy-host(testbus_handle+…) frame',
          actual: `${crash[crash.length - 1] ?? '(no crash line)'} / ${trace[trace.length - 1] ?? '(no named frame)'}` });
    /* A crash is not a clean close: the launcher gives the device back to
     * Move, and the next open is a full launch. */
    await dev.open(probe);
}, { needs: 'testbus' });
