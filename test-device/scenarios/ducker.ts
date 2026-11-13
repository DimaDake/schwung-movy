/* The Ducker's sidechain: a note on one track ducks another track's audio.
 *
 * The Ducker (charlesvestal) is an audio FX with no audio sidechain input; a
 * MIDI note fires its envelope, and its Channel picks whose notes. schwung
 * hands every slot's notes to every chain's audio FX (FX_BROADCAST); movy
 * handed a track's notes only to its own chain, on channel 1, so a Ducker on
 * the bass never heard the kick. chain_slots.rs `sidechain` is the fix, and
 * its unit test pins the routing against a fake chain host. What only a real
 * stack can add is the rest of the path: the pinned chain host taking the
 * broadcast to the real ducker.so, and the ducker actually pulling the level
 * down — witnessed by the ducked chain's own output peak (`chpeak`).
 *
 * Chains 12-14, which no other scenario touches. The trigger tracks have no
 * module at all: a track's notes are a sidechain whether or not it sounds.
 *
 * Covers:
 *   D1 a ducker loads into a sounding chain's fx1, and the chain sounds
 *   D2 a held note on the track the ducker listens to pulls the level down
 *   D3 the same note on another track does not (the Channel filter)
 *   D4 the level comes back once the trigger is released
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const DUCKED = 12;
const TRIGGER = 13;
const OTHER = 14;
const SYNTH = 'obxd';
const NOTE = 60;
const KICK = 36;
/* Ducked at depth 1.0 is silence; a chain's peak rests near, not at, 0. */
const DUCKED_MAX = 300;

scenario('ducker', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const ep = (key: string, value: string): Promise<void> => t.tx.engineSetQueued(key, value);

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);

    t.need.register(async () => {
        await ep(`ch${DUCKED}:midi`, `128.${NOTE}.0`);
        for (const c of [TRIGGER, OTHER]) await ep(`ch${c}:midi`, `128.${KICK}.0`);
        await ep(`ch${DUCKED}:fx1:module`, '');
        await ep(`ch${DUCKED}:synth:module`, '');
    });

    const load = async (component: string, module: string): Promise<boolean> => {
        const line = `chain ${DUCKED}: ${component} = ${module}`;
        const before = (await dev.logLines(line)).length;
        await ep(`ch${DUCKED}:${component}:module`, module);
        try {
            await until(t.tx, `chain ${DUCKED} to load ${module}`,
                () => dev.logLines(line), (v) => v.length > before, { within: 4000, every: 120 });
            return true;
        } catch { return false; }
    };
    const synthOk = await load('synth', SYNTH);
    const fxOk = await load('fx1', 'ducker');
    /* Gate mode: ducked for exactly as long as the trigger is held, so a
     * read cannot miss a short envelope. No attack or release to wait out. */
    for (const [k, v] of [['channel', String(TRIGGER + 1)], ['trigger_note', String(KICK)],
                          ['mode', 'Gate'], ['depth', '1.0'], ['attack', '0'], ['release', '0']])
        await ep(`ch${DUCKED}:fx1:${k}`, v);

    /* chpeak is one block's peak; the loudest of several reads a held note. */
    const peak = async (): Promise<number> =>
        Number((await t.tx.engineGet('chpeak').catch(() => '')).split(',')[DUCKED]) || 0;
    const loudest = async (n = 10): Promise<number> => {
        let max = 0;
        for (let i = 0; i < n; i++) {
            max = Math.max(max, await peak());
            await t.tx.frames(6);
        }
        return max;
    };
    const kick = async (chain: number): Promise<number> => {
        await ep(`ch${chain}:midi`, `144.${KICK}.127`);
        await t.tx.frames(20);
        const p = await loudest();
        await ep(`ch${chain}:midi`, `128.${KICK}.0`);
        await t.tx.frames(20);
        return p;
    };

    await ep(`ch${DUCKED}:midi`, `144.${NOTE}.100`);
    await t.tx.frames(60);
    const open = await loudest();
    t.note('levels', `open=${open}`);
    t.check('sounds', `${SYNTH} + ducker load into chain ${DUCKED} and a held note sounds`,
        synthOk && fxOk && open > DUCKED_MAX * 4,
        { expected: `both loaded, peak > ${DUCKED_MAX * 4}`,
          actual: `synth=${synthOk} fx=${fxOk} peak=${open}` });

    const other = await kick(OTHER);
    const ducked = await kick(TRIGGER);
    const after = await loudest();
    t.note('levels', `other=${other} ducked=${ducked} after=${after}`);
    t.check('ducks', `a note on track ${TRIGGER + 1} ducks track ${DUCKED + 1}`,
        ducked <= DUCKED_MAX,
        { expected: `peak <= ${DUCKED_MAX} while the trigger is held`, actual: `peak=${ducked} (open ${open})` });
    t.check('channel-filter', `the same note on track ${OTHER + 1} leaves it alone`,
        other > DUCKED_MAX * 4,
        { expected: `peak > ${DUCKED_MAX * 4}`, actual: `peak=${other}` });
    t.check('recovers', 'the level comes back once the trigger is released',
        after > DUCKED_MAX * 4,
        { expected: `peak > ${DUCKED_MAX * 4}`, actual: `peak=${after}` });
});
