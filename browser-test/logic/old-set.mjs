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
 * the same path a device open takes — and asserts the three things a user
 * actually looks for:
 *
 *   1. the sequencer data arrives at the engine LINE FOR LINE,
 *   2. the instruments arrive: movy's own chains for a set that hosts them,
 *      and schwung's four slots left alone for a set that does not,
 *   3. the surface comes back as it was saved, not at its defaults.
 *
 * Run by browser-test/logic.mjs.
 */

import { readFileSync } from 'node:fs';
import {
    installMockFs, uninstallMockFs, resetStoreRotation, resetPorts,
    loadPerSetFlags, ok, eq, _log,
} from './harness.mjs';

const ACTIVE = '/data/UserData/schwung/active_set.txt';
const FIX = 'browser-test/fixtures/old-sets';

const read = (arm, file) => readFileSync(`${FIX}/${arm}/${file}`, 'utf8');

/** The state file's BODY: what the engine is handed once persist-store has
 *  peeled off the `gen`/`end` envelope it stores durability in. Comparing
 *  against this rather than the raw file is what keeps the assertion about the
 *  music surviving rather than about the envelope's spelling. */
function fileBody(file) {
    return file.split('\n')
        .filter((l) => !l.startsWith('gen ') && !l.startsWith('end ') && l !== '')
        .join('\n') + '\n';
}

/** The `cl <track> …` lines of a state blob, as `track -> note count`. */
function clipNotes(blob) {
    const out = {};
    for (const line of blob.split('\n')) {
        if (!line.startsWith('cl ')) continue;
        const parts = line.split(' ');
        const track = Number(parts[1]);
        const notes = parts.slice(5).join(' ');
        out[track] = notes === '' ? 0 : notes.split(';').length;
    }
    return out;
}

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

    const UUID = 'OLD-SET-UUID';
    const DIR = `/data/UserData/schwung/modules/tools/movy/sets/${UUID}`;

    /* Open the fixture the way the device does — active_set.txt names it, the
     * two state files are where movy looks, and nothing else is seeded. The
     * chain loads are reported drained (`chpend` 0) so the run reaches `ready`
     * and the preset blobs go out; the settling gap itself is set-settling's
     * subject, not this suite's. */
    const boot = (arm) => {
        const fs = installMockFs({
            [ACTIVE]: `${UUID}\nAn Older Set\n`,
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
        const file = read(arm, 'seq-state.json');

        eq('A the set opens', sessionPhase(), 'ready');

        /* The sequencer half. Pushed verbatim — an envelope this build could
         * not parse resolves to BLANK_STATE, which is a silent empty set. */
        eq('A the state went in once', eng.stateLoads.length, 1);
        eq('A the engine got the file, line for line', eng.stateBlob, fileBody(file));
        ok('A the saved tempo travels with it', eng.stateBlob.includes('\nbpm 12300\n'));

        const notes = clipNotes(eng.stateBlob || '');
        eq('A track 0 keeps its 32 notes', notes[0], 32);
        eq('A track 1 keeps its 9 notes', notes[1], 9);
        eq('A track 2 keeps its 10 notes', notes[2], 10);

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

        /* And the set now has a history, seeded from the very files it was
         * opened from. Asserted through the REAL lifecycle rather than by
         * calling adoption directly: a hook that stopped being reached would
         * pass every unit test adoption has.
         *
         * It has to be the ADOPTED entry specifically. The `open` capture also
         * writes an index and a version directory, so "there is a history" is
         * satisfied with adoption removed entirely — which is exactly what the
         * first version of this assertion did. */
        const vidx = JSON.parse(fs.files[`${DIR}/versions.json`] || '{"v":[]}');
        ok('opening an old set adopted what was already there',
            vidx.v.some((r) => r.why === 'adopted'));
        ok('and copied it out of the rotation',
            Object.keys(fs.files).some((p) => p.startsWith(`${DIR}/v/`)));
        ok('without touching the file it adopted',
            fs.files[`${DIR}/seq-state.json`] === read(arm, 'seq-state.json'));

        /* This vintage predates send buses. The document must still be sent
         * (it is what unloads the previous set's) and must invent nothing. */
        ok('A no send bus is conjured out of a set that has none',
            !(chainDoc(eng) || []).some((e) => e.includes(':fx1=') && e.startsWith('snd')));
        teardown();
    }

    /* ── A set schwung USED to host the first four tracks of ─────────────── */
    {
        const arm = 'schwung-tracks';
        /* The rack those four tracks were built on, as the device would still
         * be holding it. This is the input the one-time migration exists for:
         * a real captured set from before movy hosted these tracks. */
        for (let sl = 0; sl < 4; sl++) {
            for (const c of ['midi_fx1', 'synth', 'fx1', 'fx2', 'fx3', 'fx4']) {
                globalThis.shadow_set_param(sl, c + '_module', '');
            }
        }
        globalThis.shadow_set_param(0, 'synth_module', 'plaits');
        globalThis.shadow_set_param(0, 'synth:state', 'OLD-PATCH');
        const { eng } = boot(arm);
        const file = read(arm, 'seq-state.json');

        eq('B the set opens', sessionPhase(), 'ready');
        eq('B the engine got the file, line for line', eng.stateBlob, fileBody(file));
        ok('B the saved tempo travels with it', eng.stateBlob.includes('\nbpm 11900\n'));

        const notes = clipNotes(eng.stateBlob || '');
        eq('B track 0 keeps its 13 notes', notes[0], 13);
        eq('B track 3 keeps its 10 notes', notes[3], 10);
        eq('B a track past the host four keeps its note', notes[9], 1);

        /* The whole point of this arm now: a set built on schwung's shadow
         * slots is MIGRATED on open. Its instrument was in Move's own set file
         * and movy could no longer reach it, so the one-time migration adopts
         * it into the chain of the same track — and says so in the document,
         * which is the only thing that puts an instrument on a track. */
        ok('B the set document was delivered', eng.params.chains !== undefined);
        eq('B the schwung rack was adopted', (chainDoc(eng) || []).join(' '), '0:synth=plaits');
        eq('B with the patch it was holding', eng.params['ch0:synth:state'], 'OLD-PATCH');
        /* And the slot is left exactly as it was: nothing is cleared, so a
         * migration that went wrong costs the user nothing. */
        eq('B the schwung slot is untouched',
           globalThis.shadow_get_param(0, 'synth_module'), 'plaits');
        eq('B the default quantise came back', seqState.defaultQuant, 100);
        teardown();
    }
}
}
