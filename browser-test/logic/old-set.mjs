/* browser-test/logic/old-set.mjs — a set written by an EARLIER movy still opens
 *
 * Every other set-state suite writes its fixture with the build under test, so
 * all of them stay green through a change that only breaks sets written before
 * it. That is the shape of the failure users report after an update: the files
 * are still on the pad, movy comes up on a blank chromatic surface with no notes
 * and no instruments, and nothing in the suite noticed.
 *
 * So the fixtures here are verbatim captures off a device (see
 * fixtures/old-sets/README.md) and are never regenerated. The suite boots the
 * real lifecycle on them — mock fs + mock engine, `seqEngineTick`/`sessionTick`,
 * the same path a device open takes, after the library's copy-import put the
 * files in place — and asserts what the UI half owes a user:
 *
 *   1. the instruments arrive: movy's own chains, with their presets,
 *   2. the surface comes back as it was saved, not at its defaults.
 *
 * The sequencer half is the engine's to read now (`engpersist`): the Rust
 * persist tests pin that an old blob still loads.
 *
 * Run by browser-test/logic.mjs.
 */

import { readFileSync } from 'node:fs';
import {
    installMockFs, uninstallMockFs, resetStoreRotation, resetPorts,
    loadPerSetFlags, ok, eq, _log,
} from './harness.mjs';

const FIX = 'browser-test/fixtures/old-sets';

const read = (arm, file) => readFileSync(`${FIX}/${arm}/${file}`, 'utf8');


export async function run() {
{
    _log('\nopening a set written by an older movy:');

    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { sessionTick, sessionPhase, resetSetSession }
        = await import('../../dist/esm/seq/set-session.js');
    const { resetSetSave } = await import('../../dist/esm/seq/set-save.js');
    const { decodeBulk } = await import('../../dist/esm/track/bulk.js');
    const { keyboardState } = await import('../../dist/esm/keyboard/state.js');
    const { seqState } = await import('../../dist/esm/seq/state.js');

    /* The mock library's one Set, which the copy-import filled from these files. */
    const DIR = '/data/UserData/UserLibrary/Movy/Sets/S1';

    /* Open the fixture the way the device does — the library names it, the
     * two state files are where movy looks, and nothing else is seeded. The
     * chain loads are reported drained (`chpend` 0) so the run reaches `ready`
     * and the preset blobs go out; the settling gap itself is set-settling's
     * subject, not this suite's. */
    const boot = (arm) => {
        const fs = installMockFs({
            [`${DIR}/seq-state.json`]: read(arm, 'seq-state.json'),
            [`${DIR}/ui-state.json`]: read(arm, 'ui-state.json'),
        });
        const eng = installMockEngine();
        eng.status.chpend = 0;
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave();
        resetStoreRotation(); resetPorts(); loadPerSetFlags(null);
        for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        return { fs, eng };
    };
    const teardown = () => {
        uninstallMockEngine(); uninstallMockFs();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave();
        resetStoreRotation(); resetPorts(); loadPerSetFlags(null);
    };

    /* The chain-set document as `<track>:<component>=<module>` strings, in the
     * order the engine receives them. Decoded from the wire rather than read
     * off the saved object: what the engine is TOLD is the only thing that puts
     * an instrument on a track. */
    const chainDoc = (eng) => {
        const items = decodeBulk(eng.params.chains);
        if (!items) return null;
        const out = [];
        for (let i = 0; i + 2 < items.length; i += 3)
            out.push(`${items[i]}:${items[i + 1]}=${items[i + 2]}`);
        return out;
    };

    /* ── A set movy hosts the first four tracks of ──────────────────────── */
    {
        const arm = 'movy-chains';
        const { eng, fs } = boot(arm);

        eq('A the set opens', sessionPhase(), 'ready');
        ok('A the engine was told to open it', eng.setCmds.includes('open S1'));

        /* The instrument half. The set says movy hosts tracks 1-4, so every
         * chain in the file has to be named in the document. */
        eq('A the document names every saved component',
            (chainDoc(eng) || []).join(' '),
            '0:synth=8w8 1:synth=obxd 1:fx1=cloudseed 2:synth=nusaw');

        /* And each one's sound: a module with no preset blob is a track that
         * came back at factory defaults, which reads as "my set is gone" just
         * as much as an empty slot does. */
        ok('A track 0 got its preset blob',
            (eng.params['ch0:synth:state'] || '').includes('"pots"'));
        ok('A track 1 got its preset blob',
            (eng.params['ch1:synth:state'] || '').includes('"preset"'));

        /* The surface half — the file's octaves and quantise, not the defaults
         * a blank set would come up with. */
        eq('A track 2 keeps its octave', keyboardState.octave[2], 5);
        eq('A the default quantise came back', seqState.defaultQuant, 0);

        ok('without touching the file it was opened from',
            fs.files[`${DIR}/seq-state.json`] === read(arm, 'seq-state.json'));

        /* This vintage predates send buses. The document must still be sent
         * (it is what unloads the previous set's) and must invent nothing. */
        ok('A no send bus is conjured out of a set that has none',
            !(chainDoc(eng) || []).some((e) => e.includes(':fx1=') && e.startsWith('snd')));
        teardown();
    }
}
}
