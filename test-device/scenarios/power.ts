/* New with WP7 — the power button, the Leave menu and the hard fallback exit
 * on movy-host, where Move is not there to own them. Standalone only.
 *
 * The power button's SysEx is injected through the same input path the SPI
 * mailbox feeds (INJECT_MIDI), so this drives movy-host's own detector, the
 * UI's dialog and the clean exit that saves. The final dbus call is a DRY RUN
 * whenever the test bus is on (host/power.c): a test must never turn the box
 * off. The real press is a manual check (plan WP7, *Deferred manual checks*).
 *
 * Covers:
 *   P1 the Leave menu offers Close Movy only (no Background without Move)
 *   P2 a power-button hold opens "Power off?" and powers nothing off by itself
 *   P3 Cancel keeps movy running
 *   P4 Power off closes cleanly, then asks for Power.shutDown (dry run)
 *   P5 Shift + volume touch + jog click is a clean exit
 *   P6 ...and still gets out when the UI is wedged in a script (hard exit)
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { cc, noteOn, CC_BACK, CC_JOG_CLICK, type Packet } from '../midi.js';

const POWER: Packet[] = [[0x04, 0xF0, 0x00, 0x21], [0x04, 0x1D, 0x01, 0x01], [0x04, 0x3A, 0x07, 0x7F], [0x06, 0x00, 0xF7, 0x00]];
const SHIFT = 49, VOL_TOUCH = 8;

scenario('power', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const leave = async () => await probe.ask({ key: 'leave' }) as any;
    const press = async () => { for (const p of POWER) await t.tx.uiMidi(p); await t.tx.frames(20); };
    /* The exit is out of band: the log (debug.log) outlives the process. */
    const exitedWith = async (pattern: string, before: number, what: string) => {
        try {
            await until(t.tx, what, async () => (await dev.logLines(pattern)).length, (n) => n > before, { within: 6000, every: 200 });
            await until(t.tx, 'movy-host to be gone', () => t.tx.running(), (up) => !up, { within: 4000, every: 200 });
            return true;
        } catch { return false; }
    };

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);

    // ── P1: the Leave menu ──────────────────────────────────────────────────
    for (let i = 0; i < 6 && !(await leave()).active; i++) { await dev.tap.cc(CC_BACK); await t.tx.frames(20); }
    const lm = await leave();
    t.check('leave-close-only', 'the Leave menu offers Close Movy only',
        lm.active && lm.title === 'Leave Movy?' && (lm.labels ?? []).join('|') === 'Close Movy',
        { expected: 'Leave Movy? → [Close Movy]', actual: JSON.stringify(lm) });
    await dev.tap.cc(CC_BACK);
    await t.tx.frames(20);

    // ── P2: the power button asks ───────────────────────────────────────────
    await press();
    const pm = await leave();
    t.check('power-dialog', 'a power-button hold opens "Power off?" and nothing else happens',
        pm.active && pm.title === 'Power off?' && pm.label === 'Power off' && (await t.tx.running()),
        { expected: 'Power off? with Power off selected, movy still running', actual: JSON.stringify(pm) });

    // ── P3: Cancel ──────────────────────────────────────────────────────────
    await dev.tap.jogTurn(1);
    await t.tx.frames(10);
    await dev.tap.cc(CC_JOG_CLICK);
    await t.tx.frames(30);
    const after = await leave();
    t.check('power-cancel', 'Cancel closes the dialog and movy keeps running',
        !after.active && (await t.tx.running()), { expected: 'dialog gone, running', actual: JSON.stringify(after) });

    // ── P4: Power off (dry run) ─────────────────────────────────────────────
    const dry = (await dev.logLines('power: DRY RUN')).length;
    await press();
    await dev.tap.cc(CC_JOG_CLICK);
    const off = await exitedWith('power: DRY RUN', dry, 'the power-off request');
    const saved = (await dev.logLines('host_power_off: movy confirmed')).length > 0;
    t.check('power-off', 'Power off closes movy cleanly, then asks com.ableton.system to shut down (dry run)',
        off && saved, { expected: 'host_power_off, then "power: DRY RUN", movy-host gone', actual: `exited=${off} confirmed=${saved}` });
    await dev.open(probe);

    // ── P5: the fallback combo ──────────────────────────────────────────────
    const fb = (await dev.logLines('fallback exit: Shift + volume touch')).length;
    await t.tx.uiMidi(cc(SHIFT, 127));
    await t.tx.uiMidi(noteOn(VOL_TOUCH, 127));
    await t.tx.uiMidi(cc(CC_JOG_CLICK, 127));
    const clean = await exitedWith('fallback exit: Shift + volume touch', fb, 'the fallback exit');
    t.check('fallback-exit', 'Shift + volume touch + jog click closes movy', clean,
        { expected: 'a "fallback exit" line and movy-host gone', actual: String(clean) });
    await dev.open(probe);

    // ── P6: ...with the UI wedged ───────────────────────────────────────────
    const hard = (await dev.logLines('fallback exit: the UI did not let go')).length;
    /* A script that never returns: UI_EVAL gives up after 5 s, the UI does not. */
    await t.tx.hostBus!.uiEval('for (;;) {}').catch(() => {});
    await t.tx.uiMidi(cc(SHIFT, 127));
    await t.tx.uiMidi(noteOn(VOL_TOUCH, 127));
    await t.tx.uiMidi(cc(CC_JOG_CLICK, 127));
    const wedged = await exitedWith('fallback exit: the UI did not let go', hard, 'the hard fallback exit');
    t.check('fallback-wedged', 'the fallback exit still gets out of a wedged UI', wedged,
        { expected: 'a hard exit ~2 s after the combo', actual: String(wedged) });
    /* A hard exit is not a clean close: the launcher gave the device back to
     * Move, so this open is a full launch. */
    await dev.open(probe);
}, { needs: 'power-button' });
