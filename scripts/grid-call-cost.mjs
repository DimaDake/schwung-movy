/* grid-call-cost.mjs — how many HOST CALLS a module page costs, per arm.
 *
 * WHY CALLS AND NOT MILLISECONDS. Every shadow_*_param is a synchronous
 * round-trip: the JS side parks until the shim services the mailbox on its next
 * SPI frame, so one call costs about one audio block (~3-4 ms) whatever the
 * value is. The tick rate — and therefore the MIDI sampling interval, and
 * therefore whether a jog detent is seen or coalesced — is set by the NUMBER of
 * calls per tick and by nothing else (see src/app/perf-probe.ts). So the call
 * count is the device's latency, in units that a laptop can count exactly.
 *
 * WHY THE DEVICE ARM IS A BASELINE AND NOT A GATE. A script CAN drive movy's
 * surface while it is overtaking — that was once written here as impossible and
 * it is not: cable 0 on /dev/shm/schwung-ui-midi reaches movy's
 * onMidiMessageInternal, measured 2026-09-13 with framebuffer hashes (cable 2
 * leaves the screen byte-identical to idle), which is exactly what
 * inject-any.py:24, measure-grid-cost.sh:35,77 and device-agent/ui-agent.py
 * depend on. What a device run cannot do is REPRODUCE: the tick rate swings
 * 63-205 Hz with load, so the same gesture times differently run to run, and two
 * arms timed differently are not an A/B. A host-call count is load-independent,
 * so the burden sits here and the device arm stays a baseline whose numbers go
 * in the ledger (SP-13), compared rather than gated.
 *
 * Here both arms run the same gesture against the same mock module, so the
 * DIFFERENCE is attributable to the flag and nothing else.
 *
 *   SCHWUNG=../schwung node build/browser.mjs
 *   node scripts/grid-call-cost.mjs off
 *   node scripts/grid-call-cost.mjs page
 *
 * MOVY_SCHWUNG_GRID used to appear here and reaches NO build — the mode became
 * the `schwunggrid` flag. Following the old lines ran `off` twice and reported
 * no difference, which is the one result an A/B must not be able to fake.
 */
import { installEnv } from '../browser-test/env.mjs';
import { installMockEngine } from '../browser-test/mock-engine.mjs';
import { MOCK_SYNTHS } from '../browser-test/mock-synth.mjs';

const env = installEnv();
const engine = installMockEngine();

/* The arm, before anything can read the mode. Merging `schwungGridMode` into the
 * one import rather than importing the module twice is the only edit to the
 * brief's snippet: the resolved mode has to be reported alongside the arm, or a
 * `page` run that pinned itself to `off` reads as a result. */
const { setSchwungGridMode, schwungGridMode } = await import('../dist/esm/renderer/schwung-grid.js');
const ARM = process.argv[2];
if (ARM !== 'off' && ARM !== 'page') { console.error('usage: grid-call-cost.mjs off|page'); process.exit(2); }
setSchwungGridMode(ARM);

/* Count at the host boundary, which is where the cost actually is. Wrapping
 * rather than replacing keeps the mock's own behaviour intact — a counter that
 * changed what the calls RETURN would be measuring a different program. */
let gets = 0, sets = 0;
const realGet = globalThis.shadow_get_param;
const realSet = globalThis.shadow_set_param;
globalThis.shadow_get_param = (...a) => { gets++; return realGet(...a); };
globalThis.shadow_set_param = (...a) => { sets++; return realSet(...a); };

await import('../dist/esm/app/globals.js');
const { appState, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
const { resetSeqState } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
const { sessionReady } = await import('../dist/esm/seq/set-session.js');
const { setFlag } = await import('../dist/esm/seq/flags.js');

const advance = (n) => { for (let i = 0; i < n; i++) globalThis.tick(); };
const sendMidi = (m) => globalThis.onMidiMessageInternal(m);

engine.reset();
/* A module with a REAL hierarchy and more parameters than one page holds: the
 * whole question is what a page CHANGE costs, and a single-page module never
 * changes page. */
env.setParams(MOCK_SYNTHS.hier_params_overflow_two_levels);
resetSeqState();
resetSeqEngine();
setFlag('chtracks', 0);
/* WITHOUT THIS THE GESTURE NEVER ARRIVES, and that is how this script reported
 * two identical arms for a whole session without anyone noticing: a press
 * before the engine holds the Set is REFUSED at the input gate (router.ts:168),
 * and the Set-commit press — which the loading splash waits on — is WALL-CLOCK
 * timed (1.5 s for Move to finish loading). Instant ticks never reach it, movy
 * stays in `settling` forever, and every arm measures the idle refresh with
 * nothing on top. Same 63-vs-64-calls-per-tick answer for both arms, which is
 * the one result an A/B must not be able to fake — and it arrived here a second
 * way, with the flag selection already correct. */
setFlag('setcommit', 0);
globalThis.init();
const m = appState.trackModels[0][1];
m.reload();
appState.currentView = VIEW_KNOBS;
/* TICK UNTIL LIVE, not a magic count. The gate decides whether the gesture
 * below is measured or thrown away, and a count that is a few ticks short fails
 * SILENTLY — which is the whole failure above. */
for (let i = 0; i < 400 && !sessionReady(); i++) advance(1);
if (!sessionReady()) {
    console.error('grid-call-cost: movy never went live, so the input gate would void every gesture — refusing to print a number');
    process.exit(3);
}
advance(20);

function window_(label, ticks, before) {
    gets = 0; sets = 0;
    if (before) before();
    advance(ticks);
    const total = gets + sets;
    return { label, ticks, gets, sets, total, perTick: total / ticks };
}

/* THE GESTURE THE COMPLAINT IS ABOUT. "Knob turns and jog paging feel slower
 * under the grid" is two gestures, and the device arm exercises both, so this
 * does too: a knob FLICK on the module's page, then a jog page change.
 *
 * A flick, not a turn, because Move's encoders deliver one CC carrying a
 * magnitude and the shadow UI re-encodes it as 1..63 — so `±63` is one message
 * on the wire and 63 of whatever the arm does with a single step. Sixty small
 * CCs would be a different, cheaper shape and would understate both arms.
 *
 * EQUAL AND OPPOSITE, so the value never rails and the page never runs off the
 * end: a flick clamped at a limit takes the arm's no-op branch, and a run that
 * drifts onto page 3 of 3 measures a page change that did not happen. */
const MOVY_KNOB = globalThis.MoveKnob1;
const FLICK_UP   = [0xB0, MOVY_KNOB, 0x3f];          /* +63 */
const FLICK_DOWN = [0xB0, MOVY_KNOB, 0x41];          /* -63 */
const JOG_FWD    = [0xB0, globalThis.MoveMainKnob, 0x01];
const JOG_BACK   = [0xB0, globalThis.MoveMainKnob, 0x7f];

/* ONE GESTURE IS A SAMPLE; TWENTY IS A RATE. The first ticks after input are
 * dominated by the arm's own settle window (store.ts suppresses its refresh for
 * REFRESH_SUPPRESS_TICKS afterwards), so a single window's number swings with
 * where in that suppression it happened to land — the same reason the device
 * suite never samples a periodic value a fixed number of times. Repeating the
 * gesture inside one window averages the transient instead of betting on it. */
const GESTURES = 20;
const SETTLE_TICKS = 15;                             /* per gesture, gesture→gesture */
const WINDOW_TICKS = GESTURES * SETTLE_TICKS;

function playGesture(i) {
    const up = i % 2 === 0;
    sendMidi([0x90, globalThis.MoveKnob1Touch, 0x7f]);   /* hand on the knob */
    sendMidi(up ? FLICK_UP : FLICK_DOWN);
    sendMidi([0x80, globalThis.MoveKnob1Touch, 0x00]);
    sendMidi(up ? JOG_FWD : JOG_BACK);
    advance(SETTLE_TICKS);
}

/* Two windows, and the difference between them is the gesture's cost. The
 * control window is the same length and the same code path minus the input, so
 * what it subtracts is the idle refresh and nothing else. */
const idle    = window_('idle', WINDOW_TICKS);
const gesture = window_('gesture', WINDOW_TICKS, () => {
    for (let i = 0; i < GESTURES; i++) playGesture(i);
});

/* THE GESTURE PREMIUM. The idle floor is shared by both arms, so subtracting it
 * leaves the calls the gesture actually added — a ratio of the two arms' TOTALS
 * would be dominated by that shared floor (measured: 2.71, and the mutation
 * below moves it to 2.80, i.e. no signal at all).
 *
 * IT IS REPORTED AS MEASURED, negative included. An input SUPPRESSES movy's
 * refresh window, so an arm whose gesture adds nothing can come out BELOW its
 * own idle floor — `off` measures −63 — and that is a finding rather than a
 * glitch. Whoever divides by it is the one who has to decide what a negative
 * denominator means; clamping it here would hide it from the human table too. */
const premium = gesture.total - idle.total;
const mode = schwungGridMode();
console.log(`arm=${ARM}  mode=${mode}  pages=${m.getBankCount()}  knobPage=${m.getKnobPage()}`);
for (const w of [idle, gesture]) {
    console.log(`  ${w.label.padEnd(12)} gets=${String(w.gets).padStart(5)} sets=${String(w.sets).padStart(3)}`
              + `  total=${String(w.total).padStart(5)}  calls/tick=${w.perTick.toFixed(2)}`);
}
console.log(`  ${GESTURES} gestures: ${premium} calls over the idle floor`
          + `  (${(premium / GESTURES).toFixed(2)} per gesture)`);

/* THE ONE MACHINE-READABLE LINE, read by browser-test/grid-cost.mjs and by
 * nothing else: the human table above is the part most likely to be reworded by
 * a later reader, and a suite that parsed it would break on a column change.
 * `calls` is the gesture premium for the whole window — a plain count of host
 * calls, no rounding and no division, so the suite can compare the two arms
 * without either of them losing a digit. `mode` is the mode that ACTUALLY ran:
 * with no schwung checkout `page` pins itself to `off`, and an arm reporting
 * only what it was ASKED for would let two identical runs read as an A/B. */
console.log(`grid-cost: arm=${ARM} mode=${mode} calls=${premium}`);
