/* Migrated from scripts/test-reselect.sh — a module reselect must leave the
 * track's automation able to play.
 *
 * It used to be about the chain host's param cache: lanes were CCs resolved
 * through `synth_params`, which a reload left EMPTY, so recorded automation was
 * silently dropped until a warm repopulated it. Lanes now write their param
 * straight through `set_param` (engine `ch<N>:lane`, drum-modules plan D1), so
 * there is no cache to warm. What a reload could still break is the BIND — the
 * engine's record of what each lane writes — so C2 reads it back.
 *
 * SCOPE / honesty: this drives the REAL browser reselect (jog-click open,
 * jog-click confirm → loadSelectedModule) and reads the engine's own binds
 * (`ch0:lanes`). It does not listen to the audio.
 *
 * The bash suite put a fixed sleep in front of every read — ~22 s of the 49 s
 * it took — because the three facts it asserts on have no ViewModel behind
 * them: the browser's open trace and the undo's staged restore are log-only. It reads the same lines out of band over
 * SSH; what changed is that every wait is now a condition, and the gesture is
 * one round trip rather than a press and a release half a second apart.
 *
 * Covers:
 *   C1  the fixture's automation lane is present on track 0 — C2 has nothing
 *       to check without it, and the bash suite treated its absence as a hard
 *       failure rather than a skip
 *   C2  after a reselect of the SAME module every lane is still bound to its
 *       param in the engine
 *   C3  a real swap is undone, rather than refused as module drift
 *   C4  the restore completed, by one of its two paths
 *   C5  on the state-blob path, that blob was captured BEFORE the swap
 *   C6  on the replay path, the preset leads and the params follow the settle
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { CC_UNDO } from '../midi.js';
import { until } from '../wait.js';

/* Frames to let movy act on a gesture before reading — a quantity of device
 * work, never a wall clock. */
const ACT = 90;

/* Log patterns. Every movy line is written TWICE — once by the shadow context
 * (DEBUG) and once by the move-shim (INFO) — so a line COUNT is the edge to
 * wait on and the LAST entry is the one to read. Nothing truncates the log
 * mid-scenario, so a count only ever grows. */
const BROWSE = 'browse: open t=0';       // openBrowser's only trace
const HIER   = 'loadHierarchy: slot=0';  // the model re-read the new module
const UNDO   = 'undo:';

/* The undo's TERMINAL lines: the blob path writes the whole module state, the
 * replay path writes its params, and a module that never comes back times out.
 * The lead of the replay path (`restored N selector/preset params`) is not one
 * of these — it is followed by the settle. */
const restoreTerminal = (l: string): boolean =>
    l.includes('restored module state') || l.includes('replayed')
    || l.includes('module restore timed out');

const hierName = (line: string): string => (line.match(/module=(\S+)/) ?? [])[1] ?? '';

async function lastLine(dev: Device, pattern: string): Promise<string> {
    const ls = await dev.logLines(pattern);
    return ls.length ? ls[ls.length - 1] : '';
}

/* Wait for the log to hold one more matching line than it did. Bounded, and it
 * reports whether it got there rather than throwing: a gesture that did not
 * land must leave the checks below to say what is missing, not abort the run. */
async function moreLines(bus: any, dev: Device, pattern: string, before: number,
                         what: string, within: number): Promise<boolean> {
    try {
        await until(bus, what, () => dev.logLines(pattern),
            (ls) => ls.length > before, { within, every: 120 });
        return true;
    } catch { return false; }
}

scenario('reselect', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    await fixture.ensure(t.bus, open, close);
    t.note('fixtureSynth', fixture.fixtureSynth(0));
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);

    /* Chain view → knobs. The bash suite's first jog click, and it is
     * load-bearing: without it the next click lands on the chain page, which
     * DRILLS into the focused module instead of opening a browser (router.ts:
     * VIEW_CHAIN on a loaded slot goes to VIEW_KNOBS, only VIEW_KNOBS opens). */
    await dev.tap.jog();
    await t.bus.frames(ACT);

    /* ── C1: the fixture's automation lane ──────────────────────────────────
     * The registry mirrors the engine's assigned lanes and the fixture seeds
     * one on track 0 (`au 0 0 50 synth:octave_transpose`), so an empty registry
     * means the FIXTURE did not load — a real failure, not a reason to skip. */
    let auto: any = null;
    try {
        auto = await until(t.bus, 'the lane registry to populate',
            () => probe.auto(),
            (v: any) => Array.isArray(v?.lanes) && v.lanes.length > 0,
            { within: 2000, every: 150 });
    } catch { auto = await probe.auto(); }
    t.note('lanes', auto?.lanes);
    t.note('laneTrack', auto?.track);
    t.check('fixture-lane',
        "the fixture's automation lane is present on track 0",
        Array.isArray(auto?.lanes) && auto.lanes.length > 0,
        { expected: 'a non-empty lane registry for the active track',
          actual: JSON.stringify(auto?.lanes ?? null) });

    /* ── C2: a SAME-module reselect leaves every lane bound ─────────────── */
    const browseBefore = (await dev.logLines(BROWSE)).length;
    const hierBefore   = (await dev.logLines(HIER)).length;

    await dev.tap.jog();                      // open the module browser
    /* The confirm must arrive with the browser UP: a click delivered while the
     * view is still VIEW_KNOBS opens the browser a SECOND time instead of
     * confirming (router.ts). The bash suite covered that gap with
     * `sleep 0.6`; `browse: open` is openBrowser's own trace, so this waits on
     * the thing the gesture is supposed to do. */
    const browsed = await moreLines(t.bus, dev, BROWSE, browseBefore,
                                    'the module browser to open', 900);
    t.note('browserOpened', browsed);
    await dev.tap.jog();                      // confirm → loadSelectedModule

    /* The reload is what could drop a bind, so wait for it to have happened —
     * loadHierarchy is the model re-reading the reloaded module. */
    const reloaded = await moreLines(t.bus, dev, HIER, hierBefore, 'the module reload', 1500);
    t.note('reloaded', reloaded);
    await t.bus.frames(ACT);
    const binds = await t.bus.getParam('overtake_dsp:ch0:lanes').catch(() => '');
    t.note('binds', binds);
    const lanes: string[] = Array.isArray(auto?.lanes) ? auto.lanes : [];
    const unbound = lanes.filter((k) => !binds.split(';').some((b) => b.endsWith(':' + k)));
    t.check('lanes-bound',
        'every automation lane is still bound to its param after the reselect',
        reloaded && lanes.length > 0 && unbound.length === 0,
        { expected: `ch0:lanes naming ${lanes.join(', ') || '(no lanes)'} after a reload`,
          actual: !reloaded ? 'the module never reloaded'
                            : (unbound.length ? `unbound: ${unbound.join(', ')} (binds "${binds}")` : binds) });

    /* ── C3–C6: a real swap, twice, then Undo ───────────────────────────────
     * A same-module reselect records nothing (loadSelectedModule skips the
     * capture when the id has not changed), so the undo path needs a real swap:
     * jog one entry down the browser list before confirming. The SECOND swap is
     * the one undone — it restores the module the first swap loaded, which is
     * the one carrying a preset. */
    const undoBefore = (await dev.logLines(UNDO)).length;

    for (let swap = 1; swap <= 2; swap++) {
        const wasModule = hierName(await lastLine(dev, HIER));
        const before    = (await dev.logLines(BROWSE)).length;
        await dev.tap.jog();                  // open the browser
        await moreLines(t.bus, dev, BROWSE, before, `browser open #${swap}`, 900);
        await dev.tap.jogTurn(1);             // jog turn → the next module
        await t.bus.frames(ACT);
        await dev.tap.jog();                  // confirm → the swap

        /* Wait for the chain to hold a DIFFERENT module. The name comes from
         * loadHierarchy, which the browser's own reload fires — so it is the
         * chain host answering, not a poll settling. A stale reload of the OLD
         * name can land first (measured: `module=plaits` then `module=rex`,
         * 54 ms apart), which a name comparison ignores and a whole-line
         * comparison could not, since every line carries its own timestamp. */
        let changed = true;
        try {
            await until(t.bus, `swap #${swap} to take`,
                () => lastLine(dev, HIER),
                (l) => { const n = hierName(l); return n !== '' && n !== wasModule; },
                { within: 1200, every: 120 });
        } catch { changed = false; }
        t.note(`swap${swap}Landed`, changed);
        t.note(`swap${swap}Module`, hierName(await lastLine(dev, HIER)));
        /* Margin on top of that line: the next browser open places its cursor
         * from the LIVE `synth:module` param, and the undo has to restore the
         * module this swap left behind. The bash suite waited 3.5 s here. */
        await t.bus.frames(changed ? 300 : 600);
    }

    await dev.tap.cc(CC_UNDO);
    t.note('undoLinesBefore', undoBefore);
    /* The restore is STAGED over ticks (undo/module-apply.ts: lead → settle →
     * verify), so what proves it finished is one of its terminal lines, not a
     * duration. Falling through to a plain read is deliberate: the checks below
     * then say which part is missing. */
    try {
        await until(t.bus, 'the module restore to complete',
            () => dev.logLines(UNDO),
            (ls) => ls.length > undoBefore && ls.some(restoreTerminal),
            { within: 2000, every: 120 });
    } catch { /* read what there is */ }
    const undoAll = await dev.logLines(UNDO);
    const fresh   = undoAll.slice(undoBefore).join('\n');
    t.note('undoLines', undoAll.slice(undoBefore));

    /* C3 ─ the swap was undone.
     *
     * The bug this guards: a track chain slot is SET as `synth:module` but
     * reports under the alias `synth_module`. Reading the colon form returned
     * null, the drift check called that "the module changed behind our back",
     * and every module undo refused and wiped the stack. Only the device proves
     * the real key convention — a mock can always be written to agree with the
     * code. Either verb passes: jogging one entry down the browser list can
     * land on NONE, which is a clear rather than a load and just as undoable. */
    const drift = fresh.includes('undo: cleared (module drift)');
    const verb  = /undo: (LOAD MODULE|CLEAR SLOT)/.test(fresh);
    t.check('undo-swap',
        'the module swap was undone (not refused as module drift)',
        !drift && verb,
        { expected: "an 'undo: LOAD MODULE' / 'undo: CLEAR SLOT' entry, and no drift refusal",
          actual: drift ? 'the undo was refused as module drift'
                        : (verb ? 'undone' : 'the swap recorded no undo entry') });

    /* C4 ─ the restore completed, by one of its two paths.
     *
     * schwung's own whole-module blob (`<component>:state`) is preferred — the
     * DSP applies preset and params together, so there is no ordering to get
     * right. The per-param replay is the fallback for modules that expose no
     * state. */
    const blobPath   = fresh.includes('undo: restored module state');
    const replayPath = fresh.includes('undo: replayed');
    t.note('restorePath', blobPath ? 'state-blob' : (replayPath ? 'replay' : 'none'));
    t.check('restore-completed',
        'the module restore completed',
        blobPath || replayPath,
        { expected: 'a restore — state blob or param replay',
          actual: blobPath ? 'restored from the module state blob'
                           : (replayPath ? 'replayed the params'
                                         : 'neither — the restore never completed') });

    /* C5 ─ on the blob path, the blob was captured BEFORE the swap.
     *
     * The blob is what the restore replays; one captured after the outgoing
     * module was already torn down would restore the wrong sound. C6 is the
     * mirror image on the other path, so exactly one of the two carries the
     * assertion on any given run — the side not taken reports n/a, which is
     * what the bash suite did too (it emitted neither a pass nor a fail there).
     */
    const captured = fresh.includes('undo: captured module state');
    t.check('restore-state-captured',
        'the state blob was captured before the swap that consumed it',
        !blobPath || captured,
        { expected: blobPath ? "an 'undo: captured module state' line" : 'n/a — the replay path ran',
          actual: !blobPath ? 'the restore took the replay path'
                            : (captured ? 'captured before the swap'
                                        : 'a state blob was restored that was never captured') });

    /* C6 ─ on the replay path, the preset leads and the params follow.
     *
     * The preset rewrites the module's params, so applying it after them would
     * overwrite everything just restored. A module that declares no preset
     * exercises no staging — the bash suite noted that rather than asserting. */
    const lead   = /undo: restored \d+ selector\/preset params/.test(fresh);
    const settle = fresh.includes('after settle');
    t.check('restore-preset-first',
        'the preset was written first and the params followed the settle',
        !replayPath || !lead || settle,
        { expected: "a post-settle replay ('... after settle') behind the preset lead",
          actual: !replayPath ? 'the restore took the state-blob path'
                              : (!lead ? 'the outgoing module declared no preset — not exercised'
                                       : (settle ? 'preset first, then the post-settle params'
                                                 : 'the lead was written but the post-settle params never followed')) });
});
