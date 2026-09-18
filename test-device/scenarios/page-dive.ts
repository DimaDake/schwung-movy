/* New with SP-17 — a file parameter's dive, on hardware.
 *
 * WHAT ONLY THE DEVICE CAN SAY. `browser-test/app-loop.mjs` already drives the
 * real controller through the real router and watches the dive happen, so the
 * SEAM is covered locally. What the local suite cannot have is the module: it
 * feeds the planner a fixture's contract, and the dive reads its directory, its
 * filter and its starting point from the MODULE's own declaration — mrsample's
 * `chain_params`, which only exist once the DSP is loaded and answering. A
 * fixture that got those four fields wrong would leave every local check green
 * and the browser opening somewhere with nothing in it.
 *
 * SO THE MODULE IS mrsample AND THE PARAM IS ITS OWN, named by the ledger's
 * "Closes when": a click on mrsample's sample parameter opens movy's browser.
 *
 * THE OUTCOME IS THE ASSERTION. `browse: open` is the MODULE browser's log line
 * and the file browser writes none, so the two things read here are the screen
 * (`probe.page()`, which reports the live view — the file browser has no page
 * behind it, so nothing else could) and the slot the commit lands in. The
 * second is the ledger's own claim: the file that was chosen is the file the
 * parameter now holds.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: which CELL the dive came from. The page
 * set under `page` is Schwung's arrangement of mrsample's levels, and pinning a
 * slot index here would make this a test of the planner's ordering rather than
 * of the seam. The row is swept instead, and the browser opening is the answer
 * — mrsample has exactly ONE filepath parameter, so a dive that opened it can
 * only have been that one.
 *
 * Covers:
 *   D1  a held knob on a filepath cell, jog-clicked, opens movy's file browser
 *   D2  a click inside that browser commits the file into the parameter
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until, WaitBudgetExceeded, PARAM_POLL_GAP } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/page-dive.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Frames of device work, never a wall clock. ACT is the settle the other
 * scenarios use for one gesture. */
const ACT = 90;

/* The arm the item is about: Schwung plans AND draws, so the controller is the
 * one holding the knob and the click it hands back is what has to become a
 * browser. Under `off` movy's own renderer never asks anybody. */
const PAGE_MODE = 'page';

/* The module the ledger names. Loaded through the same param the chain UI
 * writes, so what the planner reads is the declaration a user would get. */
const MODULE = 'mrsample';

/* mrsample's OWN declaration of the sample parameter, from its `chain_params`.
 * Asserted against what the commit produces: the browser is opened with these,
 * so a file outside the root would mean the dive passed the wrong ones. */
const ROOT = '/data/UserData/UserLibrary/Samples';
const FILTER = ['.wav', '.mp3', '.flac', '.aif', '.aiff'];

/* The engine's param map is reached through the `overtake_dsp:` namespace and
 * NOTHING ELSE — the shim routes that prefix and has no route for a bare
 * `ch0:` key, which is a read that times out rather than one that answers
 * empty. `scripts/engine-param.mjs` prefixes for the same reason on the way in;
 * this is the other half of that path. */
const SAMPLE_PARAM = 'overtake_dsp:ch0:synth:sample_path';

type Page = { module?: string; pageIndex?: number; pageCount?: number;
              renderer?: string; view?: string; cells?: ({ name?: string } | null)[] };

scenario('page-dive', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* A movy track's chain lives in movy's OWN engine: the param is written
     * through `ch0:` and only while movy is open. */
    const ep = async (key: string, value: string): Promise<void> => {
        await run('node', [join(MOVY, 'scripts', 'engine-param.mjs'),
                           'set', key, value, t.host], { maxBuffer: 8 * 1024 * 1024 });
    };

    const RESTORE = fixture.fixtureSynth(0);
    t.note('fixtureSynth', RESTORE);

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);
    /* The slot is put back whatever happens below — this suite loads a module
     * into it that the rest of the sweep does not expect. */
    t.need.register(async () => { await ep('ch0:synth:module', RESTORE); });

    /* AND SO IS THE MACHINE-LEVEL PREFS FILE, because D2 COMMITS A FILE and a
     * commit remembers the directory it came from: `rememberFileDir` writes
     * `prefs.json`'s `fileDirs['mrsample:sample_path']`, which no set owns and
     * the next scenario would inherit. Snapshotted after `fixture.ensure`, so
     * what is restored is the state the fixture installed. `prefs.ts` re-reads
     * the file for every read-modify-write ("not cached"), so a restore after
     * movy has already written is not clobbered by a stale in-RAM copy.
     *
     * SHIPPED OVER `scp` TO A TEMP NAME AND `mv`, the way `device.ts` ships the
     * engine — not a shell redirect carrying the snapshot, and NOT a base64
     * round trip. The box is BusyBox and has no `base64` at all (measured:
     * `command -v base64` is empty), so an encoded trip through the shell fails
     * there and fails SILENTLY — the `&&` never runs, the file keeps the
     * directory movy remembered, and only the runner's `undo_error` note says
     * anything. `mv` also replaces the inode, so movy cannot read a
     * half-written file. */
    const PREFS = '/data/UserData/schwung/modules/tools/movy/prefs.json';
    const sshBox = async (cmd: string): Promise<string> => {
        const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
                                             `ableton@${t.host}`, cmd],
                                     { maxBuffer: 8 * 1024 * 1024 });
        return stdout;
    };
    const prefsBefore = await sshBox(`cat '${PREFS}' 2>/dev/null || true`);
    t.need.register(async () => {
        if (!prefsBefore.trim()) { await sshBox(`rm -f '${PREFS}'`); return; }
        const snap = join(tmpdir(), `movy-prefs-${process.pid}.json`);
        writeFileSync(snap, prefsBefore);
        await run('scp', ['-q', snap, `ableton@${t.host}:${PREFS}.new`]);
        await sshBox(`mv '${PREFS}.new' '${PREFS}'`);
        rmSync(snap, { force: true });
    });

    const pageNow = async (): Promise<Page | null> => {
        try {
            const p = (await probe.page()) as Page & { error?: string };
            return p && p.error === undefined ? p : null;
        } catch { return null; }
    };
    const waitPage = async (pred: (p: Page) => boolean, what: string,
                            within: number): Promise<Page | null> => {
        try {
            return await until(t.bus, what, async () => (await probe.page()) as Page,
                               (p) => !!p && pred(p), { within, every: 150 });
        } catch { return await pageNow(); }
    };
    /* The open browser: its directory, its cursor, its rows. Null once it has
     * closed, which is what a commit does in the same call that writes. */
    type Browse = { dir: string; sel: number;
                    items: { name: string; path: string; isDir: boolean }[] };
    const browseNow = async (): Promise<Browse | null> => {
        try {
            const r = (await probe.browse()) as { browse?: Browse } & { error?: string };
            return r && r.error === undefined ? (r.browse ?? null) : null;
        } catch { return null; }
    };
    const describe = (p: Page | null): string => !p ? 'movy has not rendered'
        : `renderer=${p.renderer} module=${p.module || '(none)'} view=${p.view} `
        + `pages=${p.pageCount} at=${p.pageIndex} `
        + `cells=[${(p.cells ?? []).map((c) => c?.name).filter(Boolean).join(' ')}]`;

    /* A chain param goes through the param slot, which can be busy: the read
     * throws rather than answering, and a scenario that let that escape reports
     * the channel's weather instead of the behaviour it is grading. Empty is
     * the absent answer and is what every caller here means by "no value yet".
     * `paramUntil` is the same read, asked until it agrees. */
    const readParam = async (key: string): Promise<string> => {
        try { return (await dev.param.get(key)).trim(); } catch { return ''; }
    };
    const paramUntil = async (key: string, ok: (v: string) => boolean,
                              within: number): Promise<string> => {
        try {
            return await until(t.bus, `${key} to settle`, () => readParam(key), ok,
                               { within, every: PARAM_POLL_GAP });
        } catch (e) {
            return e instanceof WaitBudgetExceeded ? String(e.last) : '';
        }
    };

    /* Page mode by OVERRIDE — `setGridMode` writes nothing, so the device's own
     * prefs are never touched and this scenario does not care how the box is
     * set. A reopen would drop it; there is none here. */
    t.note('gridMode', await probe.setGridMode(PAGE_MODE));

    await ep('ch0:synth:module', MODULE);
    const hasCells = (p: Page): boolean => (p.cells ?? []).some((c) => !!c?.name);
    /* EITHER LABEL, and not out of leniency. The view model reports the module
     * by its DISPLAY name when the chain host is answering `synth:name` and by
     * its raw id when it is not (model/store.ts: pollModuleName) — so the same
     * loaded module reads `MrSample` and `mrsample` on different runs, which
     * was measured: the first run of this scenario passed this check and the
     * second failed it with nothing about the module having changed. Casing is
     * not what this check is about; identity is. */
    const sameModule = (p: Page | null): boolean =>
        (p?.module ?? '').toLowerCase() === MODULE;
    const loaded = await waitPage((p) => sameModule(p) && hasCells(p)
                                       && p.renderer === PAGE_MODE,
                                  `${MODULE}'s page under page mode`, 6000);
    t.note('pageAtLoad', describe(loaded));
    t.check('dive-module-is-on-screen',
        'the module the dive belongs to is loaded and Schwung is drawing it',
        !!loaded && sameModule(loaded) && loaded.renderer === PAGE_MODE,
        { expected: `a rendered ${MODULE} page under renderer=${PAGE_MODE}`,
          actual: describe(loaded) });

    const viewNow = async (): Promise<string> => ((await pageNow())?.view) ?? '';

    /* ONE VIEW DOWN FIRST, AND IT IS NOT OPTIONAL. movy OPENS ON THE CHAIN
     * VIEW, where the JOG moves chain SLOTS — `schwungChromeFor` is passed
     * `paging: false` there for exactly that reason. A sweep run from the chain
     * view therefore pages nothing, walks the chain instead, and takes the
     * module it is testing off the slot: measured, three pages of "sweep" ended
     * with the screen still reading `chain` and the parameter gone.
     *
     * A jog CLICK drills in. Repeated against the screen it is supposed to
     * produce rather than fired blind, because a click that lands somewhere
     * else leaves the rest of the run on a view it cannot page from. */
    let at = await pageNow();
    for (let i = 0; i < 3 && at && at.view !== 'knobs'; i++) {
        await dev.tap.jog();
        await t.bus.frames(ACT);
        at = await waitPage((p) => p.view === 'knobs', 'the knobs view', 1200);
    }
    t.note('viewAfterDrill', at?.view);
    t.note('cellsAtDrill', (at?.cells ?? []).map((c) => c?.name).filter(Boolean));

    /* ── D1: the held filepath cell, jog-clicked, opens movy's browser ───────
     *
     * PAGE FIRST, THEN SWEEP THE ROW. mrsample's sample parameter is not on the
     * face: Schwung's plan puts the root knobs on one page and `sample_path`
     * last on the "Sample" page behind it. So the row is swept page by page
     * until a jog-click leaves the knobs — a click on any OTHER cell of this
     * module does nothing a browser could be confused with, and there is
     * exactly one filepath parameter, so the screen changing is the dive.
     *
     * BOUNDED, and the bound is the point: an unbounded sweep would hide a dive
     * that never fires behind a run that never ends. Three pages is more than
     * the plan needs (the sample cell is on the second) and the sweep stops the
     * moment the screen changes, so a device that is working costs two pages. */
    let view = await viewNow();
    let found = { pg: -1, slot: -1 };
    for (let pg = 0; pg < 3 && view !== 'file-browse'; pg++) {
        for (let slot = 0; slot < 8 && view !== 'file-browse'; slot++) {
            /* The knob is really TOUCHED, not merely held down: the controller
             * routes a click to its own grid only while one of its cells is
             * under a finger, and the release is a note-on with d2 = 0 — see
             * Device.knobHold. */
            await dev.knobHold(slot, async () => {
                await t.bus.frames(4);
                await dev.tap.jog();
            });
            await t.bus.frames(ACT);
            view = await viewNow();
            if (view === 'file-browse') found = { pg, slot };
        }
        if (view === 'file-browse') break;
        await dev.tap.jogTurn(1);
        await t.bus.frames(ACT);
    }
    t.note('diveAt', found);
    t.note('viewAfterDive', view);
    t.check('file-param-click-opens-the-browser',
        'a held filepath knob, jog-clicked, leaves the knobs for movy\'s file browser',
        view === 'file-browse',
        { expected: 'the screen to be movy\'s file browser after a held knob is '
                  + 'jog-clicked on the cell holding the module\'s sample path',
          actual: `screen is "${view}"` + (found.slot >= 0
                  ? ` (dive came from page ${found.pg} slot ${found.slot})`
                  : ' — no cell of the first three pages opened anything') });

    /* ── D2: a click on a FILE commits it, and the parameter holds it ────────
     *
     * THE WALK IS DRIVEN BY THE BROWSER'S OWN ROWS, and that is a correction
     * rather than a flourish. The first version of this check clicked four
     * times and read "the screen is no longer the browser" as "a file was
     * committed"; on this device that was FALSE — the screen left and the
     * parameter stayed empty — and nothing in the check could tell a commit
     * from a cancel from a click that walked the tree. `probe.browse()` is what
     * fixes it: the rows say whether the cursor is on a directory (a click
     * walks) or on a file (a click writes), so the loop finishes standing on a
     * file and NAMES the file it expects the parameter to hold.
     *
     * ONE RULE, TWO ROWS. `..` is pushed only below the declared root, and
     * directories sort before files, so a browser whose cursor is on `..` is
     * one jog-turn from a sibling, and a browser in a directory that holds
     * audio files reaches one in a single step. Which entry that is stays the
     * USER'S LIBRARY's business — a check that named `3 guitars beat` would
     * call a reorganised sample folder a movy defect — so the file is read back
     * from the device and graded by what the browser said, not by a guess.
     *
     * BOUNDED, and a walk that never reaches a file FAILS rather than passing:
     * an empty listing, or a tree of nothing but directories, exits with the
     * row it gave up on recorded. */
    const before = await readParam(SAMPLE_PARAM);
    let expect: string | null = null;
    let where = '';
    for (let i = 0; i < 12 && !expect; i++) {
        const b = await browseNow();
        if (!b || b.items.length === 0) { where = where || 'no rows'; break; }
        const sel = b.items[Math.min(Math.max(b.sel, 0), b.items.length - 1)];
        if (!sel) { where = b.dir + ' → the cursor is past the last row'; break; }
        where = b.dir + ' → ' + sel.name + (sel.isDir ? '/' : '');
        if (sel.isDir && sel.name === '..') {
            /* UP IS A DEAD END FOR THIS WALK — clicking it only changes which
             * directory the same rule runs in again — so `..` is stepped over
             * and the click is spent on a sibling. */
            await dev.tap.jogTurn(1);
            await t.bus.frames(ACT);
            continue;
        }
        await dev.tap.jog();
        await t.bus.frames(ACT);
        if (!sel.isDir) expect = sel.path;
    }
    t.note('browseWalk', where);
    /* WAITED FOR, not read once: the commit is an ordinary param write through
     * the single `overtake_dsp:` SHM slot every other write uses, so it settles
     * a beat after the screen does. Polled at PARAM_POLL_GAP for the same
     * reason every other read of that slot is. */
    const after = await paramUntil(SAMPLE_PARAM, (v) => v !== '', 3000);
    t.note('browseExpect', expect);
    t.note('samplePathBefore', before);
    t.note('samplePathAfter', after);
    const lower = String(after || '').toLowerCase();
    const committed = !!expect && after === expect && after !== before
        && after.startsWith(ROOT + '/')
        && FILTER.some((ext) => lower.endsWith(ext));
    t.check('dive-commit-lands-in-the-parameter',
        'the file the browser committed is what the sample parameter holds',
        committed,
        { expected: expect
                  ? `the parameter to hold ${JSON.stringify(expect)} — the file the `
                  + `browser's own rows said was under the cursor (a path under ${ROOT} `
                  + `ending in ${FILTER.join('|')}, different from "${before}")`
                  : `the browser to put a file under the cursor (a path under ${ROOT} `
                  + `ending in ${FILTER.join('|')}); it gave up at ${where}`,
          actual: `the parameter holds ${JSON.stringify(after)}` });

    t.note('viewAtEnd', await viewNow());
    await probe.setGridMode(null);
    await ep('ch0:synth:module', RESTORE);
});
