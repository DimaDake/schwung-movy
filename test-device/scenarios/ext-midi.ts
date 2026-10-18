/* A USB-A keyboard (cable 2) plays the ACTIVE track, from the engine.
 *
 * What it proves: a cable-2 note enters movy-host's RX parser (INJECT_MIDI is
 * the same parser as the SPI mailbox), reaches the engine marked EXTERNAL, and
 * ext_route.rs sounds it on the chain the UI pushed in `extmap` — the witness is
 * that chain's output peak (`chpeak`), since nothing else reads back a sound.
 *
 * Covers:
 *   E1 a cable-2 note on track 1 sounds chain 0, and chain 1 stays silent
 *   E2 after selecting track 2 the same key no longer sounds chain 0: the route
 *      followed the selection (E1 is the control that it would have)
 * Track 2's fixture rack is silent on chpeak even under a real pad press, so
 * which pad a key plays is pinned in ext_route.rs and logic/external-midi.mjs,
 * as is the recording (the UI's pad path).
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import type { Packet } from '../midi.js';

/* Any channel plays; channel 4 proves the engine does not filter on it. */
const keyOn = (n: number): Packet => [0x29, 0x93, n, 110];
const keyOff = (n: number): Packet => [0x28, 0x83, n, 0];
/* A synth's tail settles to a small residue, not to 0 (plaits rests near 50). */
const QUIET = 300;

scenario('ext-midi', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);
    t.note('synths', `${fixture.fixtureSynth(0)} / ${fixture.fixtureSynth(1)}`);

    /* chpeak is one block's peak, so a held note is sampled several times. */
    const peaks = async (): Promise<number[]> =>
        (await t.tx.engineGet('chpeak').catch(() => '')).split(',').slice(0, 2).map((v) => Number(v) || 0);
    const loudest = async (n = 12): Promise<number[]> => {
        const max = [0, 0];
        for (let i = 0; i < n; i++) {
            const p = await peaks();
            for (const c of [0, 1]) max[c] = Math.max(max[c], p[c]);
            await t.tx.frames(8);
        }
        return max;
    };
    /* A release tail would read as the wrong chain sounding. */
    const quiet = async (): Promise<void> => {
        for (let i = 0; i < 60; i++) {
            const p = await peaks();
            if (p[0] < QUIET && p[1] < QUIET) return;
            await t.tx.frames(30);
        }
        t.note('neverQuiet', JSON.stringify(await peaks()));
    };
    const hold = async (on: Packet, off: Packet): Promise<number[]> => {
        await quiet();
        await t.tx.uiMidi(on);
        try { return await loudest(); } finally { await t.tx.uiMidi(off); }
    };
    const play = (key: number) => hold(keyOn(key), keyOff(key));

    await dev.selectTrack(0);
    const p0 = await play(60);
    t.check('e1-active-track', 'a cable-2 note sounds the active track (chain 0) and not chain 1',
        p0[0] >= QUIET && p0[1] < QUIET, { expected: `chain 0 peak >= ${QUIET}, chain 1 < ${QUIET}`, actual: JSON.stringify(p0) });

    await dev.selectTrack(1);
    const p1 = await play(36);
    t.check('e2-follows-selection', 'after selecting track 2 the key no longer sounds chain 0',
        p1[0] < QUIET, { expected: `chain 0 peak < ${QUIET}`, actual: JSON.stringify(p1) });
    await dev.selectTrack(0);
});
