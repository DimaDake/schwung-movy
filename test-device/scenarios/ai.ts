/* The generators (plans/2026-10-27-algorithmic-generators-design.md) end to
 * end on the device: the job reads the Set, runs the presets one per tick and
 * opens the preview over the clip.
 *
 * Covers:
 *   A1 Shift + HOLD Step 16 runs Smart Quantize; the preview opens on option 1,
 *      the played notes on the grid, written into the clip at quantize 0
 *   A2 the preview lights the knobs at their positions like a module's params,
 *      and a knob turn rewrites the option over the clip
 *   A3 the jog switches to option 3 and a jog click keeps it
 *   A4 Shift + HOLD Step 14 on an EMPTY slot writes a variation there, at the
 *      source clip's length; Back keeps it
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

const SHIFT = 49, BACK = 51, JOG = 14, JOG_CLICK = 3;
const STEP14 = 16 + 13, STEP16 = 16 + 15;

/* `slot len loop num/den transpose quant|tick.gate.pitch.vel,...` per clip.
 * The test bus is line-based and hands a multi-line get back joined by
 * spaces, so a clip is found by its shape, not by line. */
const clipLine = (dump: string, slot: number): string =>
    new RegExp(`(?:^|\\s)(${slot} \\d+ \\d+ \\d+/\\d+ -?\\d+ \\d+\\|\\S*)`).exec(dump)?.[1] ?? '';

scenario('ai', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const cc = (n: number, v: number) => t.tx.uiMidi(ccPacket(n, v));
    const dump = () => t.tx.engineGet('ait:0').catch(() => '');
    const line = (slot: number) => dump().then((d) => clipLine(d, slot));
    const waitLine = (what: string, slot: number, pred: (l: string) => boolean) =>
        until(t.tx, what, () => line(slot), pred, { within: 1500 }).catch(() => line(slot));

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);
    try {
        await t.tx.engineSet('cmd', 'clipdelat 0 0;clipdelat 0 1;aiclip 0 0 16 1 1 100 3.30.60.90,101.20.64.80,197.20.67.85;clipsel 0 0');
        await t.tx.frames(60);
        const played = await line(0);

        await dev.holdCc(SHIFT, () => dev.hold(STEP16, () => t.tx.frames(560)));
        const g = await waitLine('quantize preview', 0, (l) => l.includes(',192.') && l !== played);
        t.check('a1-quantize-preview', 'Shift + hold Step 16 previews option 1, on the grid, at quantize 0',
            g.startsWith('0 16 0 1/1 0 0|0.') && g.includes(',96.') && g.includes(',192.'), { expected: 'notes at 0, 96, 192, quant 0', actual: g });

        /* Knob 1 (TIMING) lit at its position: the row is movy's one writer,
         * which logs each change as `knobLED k=<n> nv=<v> color=<c>`. */
        await t.tx.frames(60);
        const led = (await dev.logLines('knobLED k=0 ')).pop() ?? '';
        t.check('a2-knob-leds-lit', 'the preview lights knob 1 at its position, like a module param',
            /color=[1-9]\d*/.test(led), { expected: 'knob 1 lit', actual: led });
        await cc(71, 104);   // three clicks down (8 raw units a click)
        const g2 = await waitLine('knob rewrite', 0, (l) => l !== '' && l !== g);
        t.check('a2-knob-rewrites-the-option', 'turning knob 1 in the preview rewrites the option over the clip',
            g2 !== '' && g2 !== g, { expected: 'a different take', actual: g2 });

        /* movy-host delivers a tick's jog turns at its flush, AFTER that tick's
         * buttons (host/deltas.c): click only once the switch has landed. */
        await cc(JOG, 2);
        const shown = await waitLine('option 3 shown', 0, (l) => l !== '' && l !== g2);
        await cc(JOG_CLICK, 127); await cc(JOG_CLICK, 0);
        await t.tx.frames(30);
        const kept = await line(0);
        t.check('a3-jog-keeps-option-3', 'the jog picks option 3 and its click keeps it',
            shown !== g2 && kept === shown, { expected: shown, actual: kept });

        await t.tx.engineSet('cmd', 'clipsel 0 1');
        await t.tx.frames(60);
        await dev.holdCc(SHIFT, async () => { await dev.hold(STEP14, () => t.tx.frames(560)); });
        const v = await waitLine('variation preview', 1, (l) => /\|\d/.test(l));
        await cc(BACK, 127); await cc(BACK, 0);
        t.check('a4-variation-empty-slot', 'Shift + Step 14 on an empty slot writes a variation at the source length',
            v.startsWith('1 16 ') && /\|\d/.test(v), { expected: 'slot 1, 16 steps, notes', actual: v });
    } finally {
        await t.tx.engineSet('cmd', 'clipdelat 0 0;clipdelat 0 1;clipsel 0 0').catch(() => {});
    }
});
