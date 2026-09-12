/* Migrated from scripts/test-master-fx.sh — a master FX module loaded from movy
 * SURVIVES persistence.
 *
 * Covers what no local suite can. Movy loads a master slot by writing
 * `master_fx:fxN:module` straight to the shim, and schwung's saver is what has
 * to notice: it asks the shim what each position holds and writes the per-set
 * state file the boot loader restores from. Movy used to have to repair
 * schwung's mirror itself, because the saver read a JS mirror that never saw
 * that write and wrote "{}" over the slot — the whole master chain gone on the
 * next boot (schwung-movy#9). Schwung v1.1.0 fixed it upstream (#221, #311) and
 * movy's workaround is gone, so this suite is now the check that the host still
 * holds up its end.
 *
 * The device fact on trial, unreachable off device: the per-set state file keeps
 * the module_id and a real DSP path after a movy load, and the shim restores it
 * at boot. Nothing in a host build can load a chain, so no local suite can ask.
 *
 * WHERE THE TIME WENT. The bash suite spent ~19 s of `sleep`, most of it in
 * front of a read that had no condition behind it. Each is now a wait on the
 * thing it stood for:
 *   - `sleep 3` / `sleep 5` after a restart is the shim's own
 *     `Shadow inprocess: chain loaded` line, which it writes AFTER the master FX
 *     and send restores and after it launches shadow_ui — the boot saying it is
 *     done, rather than a guess at how long a boot takes;
 *   - `sleep 2` in the autosave poll is the state file itself, read until it
 *     carries a module_id;
 *   - `sleep 0.4` between jog detents is device frames (rule 1).
 *
 * WHAT CHANGED BEYOND THE MECHANICS:
 *   - `movy actually exited` was an `echo` warning, never a check — the bash
 *     printed `! no unload line` and went on to wait for an autosave that cannot
 *     arm while movy is still overtaking. It is now an assertion, which is the
 *     direction a migration is allowed to move.
 *   - the empty-slot guard is scoped to THIS boot. The bash read `cat $LOG`
 *     after clearing it, which is the same thing by hand; here the boot is waited
 *     for by its own marker first, so the read cannot land mid-restore and see
 *     the previous boot's line.
 *   - the jog distance to MFX 1 is the index of `master_fx:fx1` in
 *     MASTER_FX_SLOTS, computed from the UI's own constant. The bash named
 *     SEND_BUSES and got the same number; neither writes the index down, because
 *     a written-down one points at the last SEND the moment a bus is added.
 *
 * Covers:
 *   C1 the shim booted with master slot 1 empty — nothing below proves anything
 *      otherwise, which is why the bash aborted here and so does this
 *   C2 the browser opened on a master FX slot
 *   C3 movy actually exited (unload fired), so autosave can arm
 *   C4 the set state kept the module
 *   C5 and a real DSP path, so the shim can restore it at boot
 *   C6 the master chain came back after a reboot
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { CC_BACK } from '../midi.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/master-fx.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LOG = '/data/UserData/schwung/debug.log';

/* The shim's "master slot 0 was restored at boot" line, across host versions.
 * schwung 1.4.0 refactored the three boot restores onto one helper and moved the
 * slot into a prefix — "MFX boot: slot 0 loaded X" became "MFX[0] boot: loaded
 * X" — so the old literal matches nothing on a current host. Read as a JS regex
 * over lines fetched by a BRE-safe literal, because the pattern's own `[0]`
 * would be a character class to the device's grep. Both arms below read it. */
const MFX0_LOADED = /MFX(\[0\])? boot: (slot 0 )?loaded/;
const MFX_LINE = 'MFX';

/* The shim's LAST boot line. `shadow_inprocess_init` logs it after the master FX
 * and send restores and after `launch_shadow_ui()`, so it is the boot stating
 * that the restore phase is behind it — the condition the bash covered with a
 * fixed `sleep 3` / `sleep 5`. */
const BOOT_DONE = 'Shadow inprocess: chain loaded';

/* The browser's only trace, by its own source's admission (openBrowser): the
 * browse view has no ViewModel, so nothing on the probe can answer this. Read as
 * a DELTA — a browse line from an earlier step is not this gesture landing. */
const BROWSE_OPEN = 'browse: open';
const MASTER_BROWSE = /browse: open t=\d+ master_fx:fx\d+ n=\d+/;

/* movy's teardown line. The autosave only ARMS when overtake is inactive, so
 * without this the wait for the save below is waiting for something that cannot
 * happen. */
const UNLOAD = 'unload: released';

/* CC 50 toggles Note/Session; movy has no constant for it in test-device/midi.ts
 * because nothing else here drives it. */
const CC_SESSION = 50;

/* Frames of device work, never a wall clock. A frame is the shim's SPI period
 * (~2.9 ms). */
/* After a gesture, for movy to have noticed it. */
const ACT  = 90;
/* Between jog detents. The bash spaced them 0.30 s apart and its ssh round trip
 * made them wider still; this is the same spacing stated as device work. */
const JOG  = 60;
/* After confirming the load. The write is a shim param set, which the shim
 * services synchronously on the SPI callback — this covers movy assembling it
 * (the pre-load dump reads the outgoing module's params) with a wide margin. */
const LOAD = 500;

/* A log wait. The ssh grep behind each poll is out of band and costs ~350 ms of
 * real time, so this is a handful of polls — the bash spent a flat 1.0-1.5 s on
 * the same fact. */
const LOG_WAIT = { within: 600, every: 100 };
/* A boot is slower than a gesture: the shim has to come back at all. */
const BOOT_WAIT = { within: 4000, every: 200 };
/* The autosave is tick-based (AUTOSAVE_INTERVAL 300 ticks, ~10 s at 30 fps, and
 * the device measures a lower rate than that under load). The bash polled this
 * one 20 times over 40 s; same budget, in device frames. */
const SAVE_WAIT = { within: 12000, every: 700 };

/* Index of master_fx:fx1 in MASTER_FX_SLOTS — the jog distance from
 * masterChainIndex 0 (movy's SEND 1) to the first master FX slot. Read from the
 * UI's own constant rather than written down: hardcoded, it pointed at the last
 * SEND slot the moment a bus was added, and this suite would have opened a
 * send's browser while reporting on the master chain. Read from SOURCE and not
 * from `dist/esm/chain/config.js`: that build artifact only exists after
 * `npm run build:browser`, and a scenario that needed it would take the whole
 * runner down on a tree where `npm run test:device` is the first thing run. */
function mfx1Slot(): number {
    const src = readFileSync(join(MOVY, 'src', 'chain', 'config.ts'), 'utf8');
    const from = src.indexOf('export const MASTER_FX_SLOTS');
    const block = src.slice(from, src.indexOf('export const MASTER_LFO_INDEX', from));
    const keys = [...block.matchAll(/componentKey: '([^']+)'/g)].map((m) => m[1]);
    const idx = keys.indexOf('master_fx:fx1');
    if (idx < 0) throw new Error('scenario: master_fx:fx1 is not in MASTER_FX_SLOTS');
    return idx;
}

scenario('master-fx', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    const ssh = async (cmd: string): Promise<string> => {
        const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes',
            `ableton@${t.host}`, cmd], { maxBuffer: 16 * 1024 * 1024 });
        return stdout;
    };

    /* A restart with a command in the DOWN window — the only moment a per-set
     * state file can be seeded, because the controlled exit rewrites these files
     * from schwung's mirror on the way out and the fresh shim reads them back
     * about four seconds later. The window is a fraction of a second wide, so
     * the poll and the write happen in one device-side script
     * (scripts/lib/restart-stack.sh, which also runs as ROOT — restart-move.sh
     * as the ableton user pkills nothing and still exits 0).
     *
     * `whileDown` carries no double quotes on purpose: lib/restart-stack.sh
     * interpolates it into an ssh double-quoted string. */
    const restartWith = async (whileDown: string): Promise<void> => {
        await run('bash', ['-c',
            `set -e; HOST=${t.host}; . "${join(MOVY, 'scripts/lib/restart-stack.sh')}"; ` +
            `restart_move_stack "${t.host}" "${whileDown}"`], { maxBuffer: 8 * 1024 * 1024 });
    };

    /* Clear the log, restart, and wait for the boot to be over by its own marker.
     *
     * The clear MUST come first, and is part of this helper so it cannot be
     * separated: the shim logs its restore ~4 s into the boot, so a clear that
     * lands after it erases the only evidence the checks below read, and a wait
     * counted from BEFORE the clear can never see the count grow — it sits on the
     * previous boot's line until its budget runs out. */
    const rebootWith = async (whileDown = ''): Promise<void> => {
        await ssh(`> ${LOG}`);
        await restartWith(whileDown);
        await until(t.bus, 'the shim to finish its boot restore',
            () => dev.logLines(BOOT_DONE), (ls) => ls.length > 0, BOOT_WAIT);
    };

    /* The state file, parsed. Null while it is absent or half-written — both are
     * ordinary on the way to a save, and neither is a failure of the write. */
    const readState = async (): Promise<any> => {
        try { return JSON.parse(await ssh(`cat ${state}`)); } catch { return null; }
    };

    /* Deploy BEFORE the seed restart. Nothing here restarts a stack, but a
     * deploy that did would undo the empty slot below, and this ordering (the
     * bash's) makes that impossible rather than unlikely. */
    await dev.deployUi();

    /* The shim logs the boot restore ~4 s in; a clear that lands after it erases
     * the one line the guard below reads, and the guard then passes on an empty
     * log no matter what the shim loaded. */
    await ssh('touch /data/UserData/schwung/debug_log_on');
    const uuid = (await fixture.activeUuid()).trim();
    if (!uuid) throw new Error('scenario: no active set uuid');
    const state = `/data/UserData/schwung/set_state/${uuid}/master_fx_0.json`;
    t.note('uuid', uuid);
    t.note('statePath', state);

    // ── C1: the shim starts with nothing in master slot 1 ────────────────────
    /* Emptying the state file is not enough on its own: the SHIM keeps whatever
     * it loaded until the process dies, so a slot left loaded by an earlier run
     * would let a resync that never works read the right answer anyway — a false
     * pass. Only a restart with an empty state file guarantees the shim starts
     * with nothing, and that is the difference between this suite proving
     * something and not. */
    /* `echo {}` and not `echo '{}'`: the command is interpolated into a
     * double-quoted ssh string, and `{}` is literal in sh (it is not a valid
     * brace expansion). */
    await rebootWith(`echo {} > ${state}`);

    const bootMfx = (await dev.logLines(MFX_LINE)).filter((l) => MFX0_LOADED.test(l));
    t.check('shim-slot-empty', 'the shim booted with master slot 1 empty',
        bootMfx.length === 0,
        { expected: 'no `MFX… boot: loaded` line after a restart on an empty slot',
          actual: bootMfx.length ? bootMfx[bootMfx.length - 1] : 'none — the slot was empty' });
    /* The bash aborted here, and for the same reason: a module the shim restored
     * by itself makes every module_id found later unattributable to this run. */
    if (bootMfx.length) throw new Error('scenario: this run cannot prove anything — the slot was not empty');

    await fixture.ensure(t.bus, open, close);

    await ssh(`> ${LOG}`);
    await dev.open(probe);

    // ── C2: the browser opens on a master FX slot ────────────────────────────
    const MFX1 = mfx1Slot();
    t.note('mfx1SlotIndex', MFX1);

    /* Session view is what puts the master chain on screen (masterChainActive).
     * masterChainIndex starts at 0, which is movy's own SEND 1 — the master page
     * reads SEND 1..N / MFX 1-4 / LFO — so the jog has to walk past EVERY send
     * before a click opens master_fx:fx1. This suite is about schwung's master
     * chain; the sends are movy-hosted and persist by a different route.
     *
     * CC 50 TOGGLES Note/Session, so which view a single tap lands on depends on
     * where movy already was — device state this suite does not own. Try, look at
     * what actually opened, and correct. */
    const openedBefore = (await dev.logLines(BROWSE_OPEN)).length;
    let browseLine = '';
    for (let attempt = 1; attempt <= 3 && !browseLine; attempt++) {
        await dev.tap.cc(CC_SESSION);
        await t.bus.frames(ACT);
        for (let i = 0; i < MFX1; i++) {
            await dev.tap.jogTurn(1);
            await t.bus.frames(JOG);
        }
        await dev.tap.jog();
        try {
            const ls = await until(t.bus, 'the browser to open on a master FX slot',
                () => dev.logLines(BROWSE_OPEN),
                (v) => v.length > openedBefore && MASTER_BROWSE.test(v[v.length - 1] ?? ''),
                LOG_WAIT);
            browseLine = ls[ls.length - 1] ?? '';
        } catch {
            /* Back out of whatever DID open, so the next attempt starts where it
             * expects. A Back with nothing to close would open the Leave modal
             * instead, so it is pressed only when something opened. */
            const opened = (await dev.logLines(BROWSE_OPEN)).length > openedBefore;
            t.note(`browseAttempt${attempt}`, opened ? 'opened elsewhere' : 'no browser');
            if (opened) { await dev.tap.cc(CC_BACK); await t.bus.frames(ACT); }
        }
    }
    t.note('browseLine', browseLine || '<none>');
    t.check('browse-on-master-fx', 'the browser opened on a master FX slot',
        MASTER_BROWSE.test(browseLine),
        { expected: 'a `browse: open t=<n> master_fx:fxN n=<count>` line',
          actual: browseLine || 'no `browse: open` line — the gesture did not land' });
    if (!browseLine) throw new Error('scenario: the gesture never reached a master slot — nothing below can be meaningful');

    /* Index 0 is the synthetic NONE entry, so step past it before confirming.
     * Confirming on NONE would CLEAR the slot, which saves exactly as happily as
     * a load and would pass C4 with nothing loaded. */
    await dev.tap.jogTurn(1);
    await t.bus.frames(ACT);
    await dev.tap.jog();
    await t.bus.frames(LOAD);

    // ── C3: movy exits, so schwung's autosave can arm ────────────────────────
    /* The periodic autosave only ARMS when overtake is inactive, so the save
     * under test cannot happen until movy has genuinely exited.
     *
     * Plain Back is not a close at all: at the root it PARKS movy under Move's UI
     * (background mode), overtake stays active, and no save ever runs — which
     * looked exactly like the bug being unfixed. close() drives the real
     * Leave-Movy flow the user walks: Back to the modal, jog to "Close Movy",
     * confirm. */
    const unloadBefore = (await dev.logLines(UNLOAD)).length;
    await close();
    let exited = true;
    try {
        await until(t.bus, 'movy to report its unload',
            () => dev.logLines(UNLOAD), (ls) => ls.length > unloadBefore, LOG_WAIT);
    } catch { exited = false; }
    t.check('movy-exited', 'movy actually exited (unload fired), so autosave can arm', exited,
        { expected: 'a `unload: released …` line since the close',
          actual: exited ? 'a fresh unload line' : 'no unload line — movy may still be parked, and the save may never arm' });

    // ── C4 / C5: the state file kept the load ────────────────────────────────
    /* Whether the saver ran at all is the difference between "the mirror was
     * cleared" and "the save never happened", and the file content alone cannot
     * tell them apart — the empty branch rewrites byte-identical content. So the
     * mtime is read alongside it. */
    const mtimeBefore = (await ssh(`stat -c %Y ${state}`)).trim();
    let saved: any = null;
    try {
        saved = await until(t.bus, 'the set state to keep the module',
            () => readState(), (s: any) => !!s?.module_id, SAVE_WAIT);
    } catch { saved = await readState(); }
    const mtimeAfter = (await ssh(`stat -c %Y ${state}`)).trim();
    t.note('stateFile', { before: saved, mtimeBefore, mtimeAfter });

    /* Nothing is asserted between the load and here on purpose: movy no longer
     * touches schwung's mirror, so it emits no line of its own, and schwung's
     * saver has not run yet. The load is proven downstream instead — the state
     * file was emptied at boot and the slot asserted empty above, so a module_id
     * appearing in it can only have come from THIS run's load. */
    t.check('state-keeps-module', 'the set state kept the module',
        !!saved?.module_id,
        { expected: 'a `module_id` in master_fx_0.json',
          actual: saved?.module_id ?? 'no module_id — the slot was erased (issue #9 unfixed)' });
    /* An id without a path is the MASTER_FX_OPTIONS gap: the file looks saved and
     * restores nothing, because the boot loader parses module_path and never
     * reads module_id. */
    const path = String(saved?.module_path ?? '');
    t.check('state-keeps-path', 'and a real DSP path, so the shim can restore it at boot',
        /\.so$/.test(path),
        { expected: 'a module_path ending in .so',
          actual: path || 'module_path is empty — it will not restore' });

    // ── C6: a real boot restores it ──────────────────────────────────────────
    /* The file surviving is the movy-side contract, but what the user actually
     * reported is the chain being empty after a power cycle — so finish by taking
     * the state file through a real boot and asking the shim to restore it. */
    let restored = '';
    if (saved?.module_id) {
        await rebootWith();
        restored = (await dev.logLines(MFX_LINE)).filter((l) => MFX0_LOADED.test(l)).pop() ?? '';
    }
    t.check('restores-after-reboot', 'the master chain came back after a reboot',
        !!restored,
        { expected: 'an `MFX… boot: loaded <id>` line after a reboot',
          actual: restored
              || (saved?.module_id
                  ? 'the state file survived but the shim did not restore it at boot'
                  : 'the slot was never saved, so there was nothing to restore') });
    t.note('bootRestoreLine', restored || '<none>');
});
