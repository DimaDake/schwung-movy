/* Migrated from scripts/test-jog-hint.mjs — the bottom "CLICK JOG" hint is a
 * HOLD gesture, asserted on the real framebuffer rather than on a log line.
 *
 * Touching the jog must not flash the hint: it appears only after the finger
 * rests for HOLD_MS without turning, and a turn takes it away again and keeps
 * it away. The hint is an inverted full-width bar on rows 58..63, so the lit
 * fraction of that band is the whole test — a fraction rather than a pixel
 * match, so the check does not re-encode the font.
 *
 * MIGRATION.md recorded this suite as blocked on a schwung change
 * (`SNAPSHOT_DISPLAY`). It never was: the framebuffer is a file in /dev/shm
 * and the bash script read it with scp all along. test-device/display.ts is
 * that same read, which is what unblocked this.
 *
 * The bash script's two infrastructure assertions ("SSH reachable", "Built +
 * deployed") are not migrated — the harness owns those.
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import { Display } from '../display.js';
import * as fixture from '../fixture.js';
import { noteOn, noteOff, cc } from '../midi.js';

/* renderer/layout.ts */
const TOAST_Y = 58;
const TOAST_H = 6;

/* midi/router.ts */
const JOG_TOUCH   = 9;
const JOG_TURN_CC = 14;

/* model/constants.ts — a WALL CLOCK in movy, so the deadline below is one too.
 * This is the one place in the tier that cannot be expressed in device frames:
 * the behaviour under test is defined in milliseconds. */
const HOLD_MS = 1000;

/* Lit fraction above which the band is a drawn toast rather than page content.
 * The bar is solid; ordinary content on those rows never comes close. */
const LIT = 0.5;

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

scenario('jog-hint', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const disp  = new Display(t.host);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    await fixture.ensure(t.bus, open, close);
    await open();
    t.need.register(async () => { await t.agent.inject(noteOff(JOG_TOUCH)); await close(); });

    const band = () => disp.bandFill(TOAST_Y, TOAST_H);

    // ── 1. Nothing before the gesture ────────────────────────────────────────
    const idle = await band();
    t.note('idleFill', idle);
    t.check('idle-clean', 'no hint before the jog is touched', idle < LIT,
        { expected: `the toast band under ${pct(LIT)} lit`, actual: `${pct(idle)} lit` });

    // ── 2. Touch and look immediately — nothing may appear ───────────────────
    /* The only check with a DEADLINE, and it asserts an ABSENCE that is only
     * true for the first HOLD_MS. The grab is an scp whose latency is not ours
     * to control, so a sample that lands late sees a hint that is up
     * LEGITIMATELY — the bash suite saw exactly that, failing on one host and
     * passing on the other minutes apart.
     *
     * So every sample is timed and only one that landed well inside the window
     * is judged. `elapsed` is deliberately conservative: measured from before
     * the inject and covering the whole grab, while the framebuffer was read
     * somewhere inside it and the device started its own timer later still.
     *
     * An inconclusive read is not evidence in either direction, so it is not
     * scored as the touch check — but it IS scored as its own check, because a
     * link that can never answer must be visible rather than silently absent. */
    const DEADLINE = HOLD_MS * 0.9;
    let onTouch: number | null = null, onTouchMs = 0;
    for (let attempt = 1; attempt <= 4 && onTouch === null; attempt++) {
        await t.agent.inject(noteOff(JOG_TOUCH));   // the hold starts from finger-up
        await sleep(400);
        const t0 = Date.now();
        await t.agent.inject(noteOn(JOG_TOUCH, 127));
        await sleep(150);                             // ample for a flash to reach the frame
        const fill = await band();
        const elapsed = Date.now() - t0;
        if (elapsed < DEADLINE) { onTouch = fill; onTouchMs = elapsed; }
        else t.note(`touchSample${attempt}`, `${elapsed}ms — past the ${HOLD_MS}ms hold, retrying`);
    }

    t.check('touch-sample-conclusive', 'a framebuffer read landed inside the hold window',
        onTouch !== null,
        { expected: `a grab completing within ${DEADLINE}ms of the touch`,
          actual: onTouch === null
            ? `4 attempts all landed past ${DEADLINE}ms — a flash and a legitimate hint cannot be told apart on this link`
            : `landed at ${onTouchMs}ms` });

    if (onTouch !== null) {
        t.note('touchFill', onTouch);
        t.check('touch-no-flash', 'touch alone draws no hint', onTouch < LIT,
            { expected: `under ${pct(LIT)} lit within ${DEADLINE}ms`,
              actual: `${pct(onTouch)} lit at ${onTouchMs}ms — the hold delay is not applied` });
    }

    // ── 3. Keep resting past the hold — it must appear ───────────────────────
    await sleep(HOLD_MS + 500);
    const held = await band();
    t.note('heldFill', held);
    t.check('hold-shows-hint', 'the hint appears once the finger has rested', held > LIT,
        { expected: `over ${pct(LIT)} lit after ${HOLD_MS}ms of hold`, actual: `${pct(held)} lit` });

    // ── 4. A turn takes it away ──────────────────────────────────────────────
    await t.agent.inject(cc(JOG_TURN_CC, 1));
    await sleep(600);
    const turned = await band();
    t.note('turnedFill', turned);
    t.check('turn-removes-hint', 'a jog turn removes the hint', turned < LIT,
        { expected: `under ${pct(LIT)} lit after a turn`, actual: `${pct(turned)} lit` });

    // ── 5. And it stays away however long the finger rests ───────────────────
    await sleep(HOLD_MS + 500);
    const after = await band();
    t.note('afterTurnFill', after);
    t.check('turned-stays-clear', 'the hint does not come back while still turned-and-held',
        after < LIT,
        { expected: `under ${pct(LIT)} lit`, actual: `${pct(after)} lit` });
});
