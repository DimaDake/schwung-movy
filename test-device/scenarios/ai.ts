/* AI MIDI (plans/2026-10-26-ai-midi-design.md) end to end, with a canned
 * reply instead of the network: `ai-fake-response.json` in movy's module dir
 * (ai/http-job.ts) answers the request, so neither a key nor the internet is
 * needed and the user's real key is never touched.
 *
 * Covers:
 *   A1 Shift + HOLD Step 16 runs Smart Quantize; the preview opens on option 1,
 *      written into the clip at quantize 0
 *   A2 the jog switches to option 3 and a jog click keeps it
 *   A3 Shift + HOLD Step 14 on an EMPTY slot writes a variation there, at the
 *      source clip's length; Back keeps it
 *   A4 with no reply to read and GENERATOR MODE = ALGORITHMIC, Smart Quantize
 *      runs the generators on the device (plans/2026-10-27-algorithmic-
 *      generators-design.md): option 1 lands the played notes on the grid
 *   A5 a knob turn in that preview rewrites the option over the clip, and the
 *      preview lights the knobs at their positions like a module's params
 * The witness is the engine's own clip dump (`ait:0`), the only read-back of
 * what a preview wrote. Option switching, per-option edits, every commit path
 * and the single undo are pinned by logic/ai-preview.mjs.
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { cc as ccPacket } from '../midi.js';
import { guardPrefs, writePrefs } from '../prefs-guard.js';

const MOD = '/data/UserData/schwung/modules/tools/movy';
const FAKE = MOD + '/ai-fake-response.json';
const SHIFT = 49, BACK = 51, JOG = 14, JOG_CLICK = 3;
const STEP14 = 16 + 13, STEP16 = 16 + 15;

/* Steps, as the prompt asks (prompt.ts): ticks 0 and 96, one step long. */
const opt = (p: number) => ({ notes: [[0, 1, p, 100], [4, 1, p + 4, 100]] });
const REPLY = JSON.stringify({ candidates: [{ content: { parts: [{ text:
    JSON.stringify({ options: [opt(72), opt(74), opt(76)] }) }] } }] });

/* `slot len loop num/den transpose quant|tick.gate.pitch.vel,...` per clip.
 * The test bus is line-based and hands a multi-line get back joined by
 * spaces, so a clip is found by its shape, not by line. */
const clipLine = (dump: string, slot: number): string =>
    new RegExp(`(?:^|\\s)(${slot} \\d+ \\d+ \\d+/\\d+ -?\\d+ \\d+\\|\\S*)`).exec(dump)?.[1] ?? '';

scenario('ai', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const hb = t.tx.hostBus!;
    const cc = (n: number, v: number) => t.tx.uiMidi(ccPacket(n, v));
    const dump = () => t.tx.engineGet('ait:0').catch(() => '');
    const waitFor = (what: string, slot: number, needle: string) =>
        until(t.tx, what, dump, (d) => clipLine(d, slot).includes(needle), { within: 1500 }).catch(() => dump());

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    /* The algorithmic block needs GENERATOR MODE = ALGORITHMIC whatever the
     * box was set to; prefs are read at open, so they are pinned before it. */
    const before = await guardPrefs(t, 'ai');
    await writePrefs(t.host, JSON.stringify({ ...(before.trim() ? JSON.parse(before) : {}), genMode: 'ALGORITHMIC' }));
    await dev.open(probe);
    await dev.selectTrack(0);
    await hb.uiEval(`host_write_file(${JSON.stringify(FAKE)}, ${JSON.stringify(REPLY)}); 0`);
    try {
        await t.tx.engineSet('cmd', 'clipdelat 0 0;clipdelat 0 1;aiclip 0 0 16 1 1 100 3.30.60.90,101.20.64.80;clipsel 0 0');
        await t.tx.frames(60);

        await dev.holdCc(SHIFT, () => dev.hold(STEP16, () => t.tx.frames(560)));
        const q = clipLine(await waitFor('quantize preview', 0, '0.24.72.'), 0);
        t.check('a1-quantize-preview', 'Shift + hold Step 16 previews option 1 at quantize 0',
            q.startsWith('0 16 0 1/1 0 0|') && q.includes('0.24.72.100'), { expected: 'option 1, quant 0', actual: q });

        /* movy-host delivers a tick's jog turns at its flush, AFTER that tick's
         * buttons (host/deltas.c): click only once the switch has landed. */
        await cc(JOG, 2);
        await waitFor('option 3 shown', 0, '0.24.76.');
        await cc(JOG_CLICK, 127); await cc(JOG_CLICK, 0);
        await t.tx.frames(30);
        const q3 = clipLine(await dump(), 0);
        t.check('a2-jog-keeps-option-3', 'the jog picks option 3 and its click keeps it',
            q3.includes('0.24.76.100'), { expected: 'option 3 notes', actual: q3 });

        await t.tx.engineSet('cmd', 'clipsel 0 1');
        await t.tx.frames(60);
        await dev.holdCc(SHIFT, async () => { await dev.hold(STEP14, () => t.tx.frames(560)); });
        const vd = await waitFor('variation preview', 1, '0.24.72.');
        const v = clipLine(vd, 1);
        await cc(BACK, 127); await cc(BACK, 0);
        t.check('a3-variation-empty-slot', 'Shift + Step 14 on an empty slot writes a variation at the source length',
            v.startsWith('1 16 ') && v.includes('0.24.72.100'), { expected: 'slot 1, 16 steps, option 1', actual: v });

        await hb.uiEval(`host_write_file(${JSON.stringify(FAKE)}, ''); 0`);
        await t.tx.engineSet('cmd', 'clipdelat 0 0;aiclip 0 0 16 1 1 100 3.30.60.90,101.20.64.80,197.20.67.85;clipsel 0 0');
        await t.tx.frames(60);
        await dev.holdCc(SHIFT, () => dev.hold(STEP16, () => t.tx.frames(560)));
        const g = clipLine(await waitFor('algorithmic preview', 0, ',192.'), 0);
        t.check('a4-algorithmic-quantize', 'with no reply to read, Smart Quantize runs the generators on the device',
            g.includes('|0.') && g.includes(',96.') && g.includes(',192.'), { expected: 'notes at 0, 96, 192', actual: g });
        /* Knob 1 (TIMING) lit at its position: the row is movy's one writer,
         * which logs each change as `knobLED k=<n> nv=<v> color=<c>`. */
        await t.tx.frames(60);
        const led = (await dev.logLines('knobLED k=0 ')).pop() ?? '';
        t.check('a5-knob-leds-lit', 'the preview lights knob 1 at its position, like a module param',
            /color=[1-9]\d*/.test(led), { expected: 'knob 1 lit', actual: led });
        await cc(71, 104);   // three clicks down (8 raw units a click)
        await t.tx.frames(30);
        const g2 = clipLine(await dump(), 0);
        t.check('a5-knob-rewrites-the-option', 'turning knob 1 in the preview rewrites the option over the clip',
            g2 !== '' && g2 !== g, { expected: 'a different take', actual: g2 });
        await cc(BACK, 127); await cc(BACK, 0);
    } finally {
        await hb.uiEval(`host_write_file(${JSON.stringify(FAKE)}, ''); 0`).catch(() => {});
        await t.tx.engineSet('cmd', 'clipdelat 0 0;clipdelat 0 1;clipsel 0 0').catch(() => {});
    }
});
