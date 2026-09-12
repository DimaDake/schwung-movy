/* Migrated from scripts/test-lfo.sh — an LFO assigned on a MOVY-hosted track
 * actually modulates.
 *
 * The bug this exists for: the LFO target commit went through
 * `shadow_set_param_timeout(track, …)`, schwung's SLOT-addressed API, which
 * refuses any index past slot 3 (shadow_ui.c: `slot >= SHADOW_UI_SLOTS`). A movy
 * track is a chain in movy's own engine, not a schwung slot, so on tracks 5-16
 * the write returned false having written nothing: the target never changed and
 * `enabled` stayed 0, so the chain's lfo_tick() skipped the LFO entirely.
 *
 * THE CHAIN NUMBER IS LOAD-BEARING. Chain 4 is the first chain past schwung's
 * four slots, so it is the smallest one that exercises the movy-hosted path at
 * all — the same assignment on chain 0 would have succeeded with the bug
 * present and the suite would have proved nothing.
 *
 * The two halves this suite joins, neither of which any local test can reach:
 * that the assignment LANDS (L2-L4) and that the chain host then really MOVES
 * the driven param (L5). Both need the real chain DSP, so both are read back
 * off the device through `chlfolog` — the engine diagnostic that makes a chain
 * log its LFO state — because the write-only param socket cannot read.
 *
 * Covers:
 *   L1  chain 4 holds the fixture's synth
 *   L2  an unassigned LFO starts inactive
 *   L3  the assignment reaches the chain instance
 *   L4  the chain marks the LFO active
 *   L5  the driven param actually MOVES — see the note on that check. KNOWN
 *       FAILING, inherited: the bash suite reported it rather than scoring it,
 *       and refused to leave it red, on the argument that a suite every sweep
 *       reads as broken stops being read at all. It is scored here, so L5 fails
 *       on every run until the chain host modulates.
 *   L6  clearing the target deactivates the LFO
 *
 * L5's ruled-out list, preserved from the bash header because it is the
 * expensive part of the note — what was checked before parking it:
 *   - The read-back is sound, so a frozen value is real. The LFO applies
 *     through chain_mod_emit_value -> chain_mod_apply_effective_value, which
 *     writes with chain_mod_set_param_string(target, param) — the same
 *     addressing chain_mod_get_param_string reads. A modulated value would
 *     show here.
 *   - Idle-skip is not starving it. lfo_tick() runs inside render_block and the
 *     shim skips that on a silent slot, which is exactly why the chain host has
 *     a `mod:tick` key; movy drives it for every chain whose synth did not
 *     render (chain_slots.rs, ChainInstance::mod_tick), on by default.
 * So the remaining suspects are inside the chain host's mod runtime — most
 * likely chain_mod_emit_value bailing on a param it cannot resolve metadata
 * for (`if (!pinfo) return -1`). That is a schwung-side investigation with a
 * real user-facing symptom (a chain LFO that assigns and reports active, but
 * does not modulate), and it wants its own session rather than a release
 * checklist.
 *
 * What the bash suite spent on `sleep`: 1.2 s per LFO report (six of them),
 * 1 s after the assignment, 3 s after the module load, 8 s after the open, and
 * 0.7 s per sample of the driven param. Every one is now a wait on the thing it
 * was standing in for.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/lfo.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* The first chain past schwung's four slots — see the header. */
const CHAIN = 4;

/* Asked for, never written down (MIGRATION.md rule 8): a hard-coded id is how
 * this suite silently stops describing the fixture it runs against. */
const SYNTH = fixture.fixtureSynth(0);

const LFO = 1;
const TARGET = 'synth';
const TARGET_PARAM = 'morph';

/* `chlfolog <n>` logs chain n's LFOs; `chain <n>: <comp> = <mod>` is the chain
 * host's load trace (chain_slots.rs). Both are read out of band over SSH, as
 * unload.ts and reselect.ts do, because the param socket the harness writes
 * through has no read verb for either. */
const LOG_LFOS   = `chain ${CHAIN} lfos:`;
const LOG_LOADED = `chain ${CHAIN}: synth = ${SYNTH}`;

/* Frames to let the engine act on a write before reading — a quantity of device
 * work, never a wall clock. */
const ACT = 90;

type Lfo = { raw: string; target: string; param: string; active: string; value: string };

const NO_REPORT: Lfo = { raw: '', target: '', param: '', active: '', value: '' };

/* One `lfoN=[target:param active=A value=V]` group out of the report line, or
 * `raw` alone when the line is missing or the group is not there. Read as
 * FIELDS rather than as a substring of the rendered line: the spacing and the
 * `-` placeholder are the logger's formatting, and a check that depends on them
 * measures the formatter. */
function parseLfo(line: string, n = LFO): Lfo {
    const m = line.match(
        new RegExp(`lfo${n}=\\[([^:]*):([^ ]*) active=(\\d+) value=([^\\]]*)\\]`));
    if (!m) return { raw: line, target: '', param: '', active: '', value: '' };
    return { raw: line, target: m[1], param: m[2], active: m[3], value: m[4] };
}

scenario('lfo', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* A movy ENGINE param write, over the WebSocket the remote UI exposes.
     *
     * NOT the test bus, and that is forced rather than preferred: testd's
     * SET_PARAM splits the wire line on its first space and treats a
     * whitespace-only remainder as a MISSING value (`protocol_split_command`
     * leaves `args` NULL, `cmd_set_param` answers ERR), so the EMPTY value that
     * clearing an LFO target consists of is unreachable through the bus. The
     * socket has no such narrowing. The bash suite wrote every one of these
     * this way; keeping one writer keeps the assignment and the clear on the
     * same path. */
    const ep = async (key: string, value: string): Promise<void> => {
        await run('node', [join(MOVY, 'scripts', 'engine-param.mjs'),
                           'set', key, value, t.host], { maxBuffer: 8 * 1024 * 1024 });
    };

    /* `chlfolog` is write-to-read: the engine logs the report when it is poked,
     * so wait for the poke's OWN line. The previous one describes the chain
     * from before whatever the caller just wrote — fixture.ts's `chloaded`
     * carries the same note for the same reason. */
    const report = async (): Promise<string> => {
        const before = (await dev.logLines(LOG_LFOS)).length;
        await ep('chlfolog', String(CHAIN));
        try {
            const ls = await until(t.bus, 'the chlfolog answer',
                () => dev.logLines(LOG_LFOS), (v) => v.length > before,
                { within: 1400, every: 120 });
            return ls[ls.length - 1];
        } catch { return ''; }
    };

    await fixture.ensure(t.bus, open, close);
    t.note('fixtureSynth', SYNTH);
    await dev.deployUi();
    await dev.open(probe);
    await t.bus.frames(ACT);

    // ── L1: the chain the rest of the suite runs on ──────────────────────────
    /* A module load into a chain the host has not been configured for is
     * DROPPED rather than deferred, so this is the one setup step whose failure
     * would make everything below prove nothing — the bash suite treated it as
     * a hard gate and said so. */
    const loadBefore = (await dev.logLines(LOG_LOADED)).length;
    await ep(`ch${CHAIN}:synth:module`, SYNTH);
    let loaded = true;
    try {
        await until(t.bus, `chain ${CHAIN} to load ${SYNTH}`,
            () => dev.logLines(LOG_LOADED), (v) => v.length > loadBefore,
            { within: 3500, every: 120 });
    } catch { loaded = false; }
    t.note('chainLoadLines', (await dev.logLines(LOG_LOADED)).length);
    t.check('chain-loaded', `chain ${CHAIN} holds a synth`,
        loaded,
        { expected: `a "${LOG_LOADED}" line in the device log`,
          actual: loaded ? 'the chain reported the load'
                         : 'the chain never loaded — the rest of this suite would prove nothing' });

    // ── L2: an unassigned LFO is inactive ────────────────────────────────────
    const beforeRaw = await report();
    const before = parseLfo(beforeRaw);
    t.note('lfoBefore', before);
    t.check('lfo-starts-inactive', 'LFO 1 starts unassigned and inactive',
        before.target === '' && before.param === '' && before.active === '0',
        { expected: 'lfo1=[ : active=0 — no target, no param, inactive',
          actual: beforeRaw || '<no chlfolog answer>' });

    // ── L3 / L4: the assignment lands in the chain ───────────────────────────
    /* Exactly the fields movy's assign path commits, in the same order. Then
     * WAIT for the chain to report them rather than sleeping at it: the write
     * is asynchronous (the engine services it on the audio thread), so the
     * wait's budget is what tells a slow assignment apart from one that never
     * happened. */
    await ep(`ch${CHAIN}:lfo${LFO}:target`, TARGET);
    await ep(`ch${CHAIN}:lfo${LFO}:target_param`, TARGET_PARAM);
    await ep(`ch${CHAIN}:lfo${LFO}:enabled`, '1');
    await ep(`ch${CHAIN}:lfo${LFO}:depth`, '0.9');
    await ep(`ch${CHAIN}:lfo${LFO}:rate_hz`, '8.0');
    await ep(`ch${CHAIN}:lfo${LFO}:sync`, '0');

    let afterRaw = await report();
    if (parseLfo(afterRaw).target !== TARGET) {
        try {
            afterRaw = await until(t.bus, 'the assignment to reach the chain',
                () => report(),
                (l) => parseLfo(l).target === TARGET,
                { within: 1500, every: 150 });
        } catch { /* the checks below report what the chain holds */ }
    }
    const after = parseLfo(afterRaw);
    t.note('lfoAfter', after);

    t.check('target-lands', 'the target reached the chain instance',
        after.target === TARGET && after.param === TARGET_PARAM,
        { expected: `lfo1=[${TARGET}:${TARGET_PARAM}`,
          actual: afterRaw || '<no chlfolog answer>' });

    t.check('lfo-active', 'the chain marked the LFO active',
        after.active === '1',
        { expected: `lfo1=[${TARGET}:${TARGET_PARAM} active=1`,
          actual: afterRaw || '<no chlfolog answer>' });

    // ── L5: THE claim — the driven param actually moves ──────────────────────
    /* Several samples, not two: a periodic value read at two arbitrary instants
     * can legitimately come back the same, and a flaky device test is worse than
     * none. The bash suite spread them over ~3.5 s of sleeps; each `report()`
     * here is its own device round trip, so the spacing is real work. */
    const samples = [after.value];
    for (let i = 0; i < 3; i++) {
        await t.bus.frames(ACT);
        samples.push(parseLfo(await report()).value);
    }
    t.note('drivenParam', samples);
    const seen  = samples.join(' -> ');
    const moved = samples[0] !== '' && samples.some((v) => v !== samples[0]);
    /* KNOWN FAILING, inherited verbatim from the bash suite. The driven param
     * reads back frozen at its base (0.500000) on BOTH hosts, every run, and did
     * so at v0.31.0 too — pre-existing, deterministic, not a regression. The
     * remaining suspects are inside the chain host's mod runtime (most likely
     * `chain_mod_emit_value` bailing on a param it cannot resolve metadata for);
     * it is a schwung-side investigation with its own user-facing symptom and it
     * wants its own session, not a release checklist.
     *
     * The bash script printed this rather than counting it, so its PASS tally
     * was 5 against 6 logical assertions. It is a SCORED check here: the fact is
     * either true or it is not, and a check that cannot fail is decoration.
     * Today it FAILS, and the failing run is the honest report — remove the
     * header note and this comment the day the chain host modulates.
     *
     * No teeth could be shown for it either, and that is a statement about the
     * check rather than a gap in the proof: teeth means removing the fix and
     * watching the check notice, and there is no fix to remove. It has never
     * been observed GREEN — not here, not on either host, not at v0.31.0. */
    t.check('param-moving', 'the driven param is moving — modulation is live',
        moved,
        { expected: 'the sampled value to differ across four samples',
          actual: moved ? `moving: ${seen}` : `frozen at ${samples[0] || '<no value>'}: ${seen}` });

    // ── L6: clearing stops it ────────────────────────────────────────────────
    await ep(`ch${CHAIN}:lfo${LFO}:target`, '');
    await ep(`ch${CHAIN}:lfo${LFO}:target_param`, '');
    await ep(`ch${CHAIN}:lfo${LFO}:enabled`, '0');

    let clearedRaw = await report();
    if (parseLfo(clearedRaw).active !== '0' || parseLfo(clearedRaw).target !== '') {
        try {
            clearedRaw = await until(t.bus, 'the LFO to deactivate',
                () => report(),
                (l) => parseLfo(l).active === '0' && parseLfo(l).target === '',
                { within: 1500, every: 150 });
        } catch { /* the check below reports what the chain holds */ }
    }
    const cleared = parseLfo(clearedRaw);
    t.note('lfoCleared', cleared);
    t.check('clear-deactivates', 'clearing the target deactivates the LFO',
        cleared.target === '' && cleared.active === '0',
        { expected: 'lfo1=[ : active=0 after the clear',
          actual: clearedRaw || '<no chlfolog answer>' });
});
