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
 * changed what the calls RETURN would be measuring a different program.
 *
 * TWO COUNTS, BECAUSE THEY ARE TWO DIFFERENT QUESTIONS AND SP-26 MOVES ONE OF
 * THEM. `calls` is params crossing the channel — the unit every number in this
 * file's history is in, and what the gesture-premium gate compares. `trips` is
 * BLOCKING ROUND TRIPS: `shadow_get_params` reads a whole page in one IPC where
 * `shadow_get_param` reads one key in one, and on device each costs ~3.4 ms
 * whatever it carries, so the trip count is the tick period and the param count
 * is not. Counting params alone is why this instrument could see SP-13's
 * attribution ("both arms read about the same NUMBER of params") but not the
 * fix for it. The bulk call's own per-key delegation is suppressed inside the
 * request: one request is one trip. */
let gets = 0, sets = 0, trips = 0, bulkDepth = 0;
const realGet = globalThis.shadow_get_param;
const realSet = globalThis.shadow_set_param;
const realGetMany = globalThis.shadow_get_params;
const realSetMany = globalThis.shadow_set_params;
globalThis.shadow_get_param = (...a) => { gets++; if (!bulkDepth) trips++; return realGet(...a); };
globalThis.shadow_set_param = (...a) => { sets++; if (!bulkDepth) trips++; return realSet(...a); };
const wrapBulk = (real) => (...a) => {
    trips++; bulkDepth++;
    try { return real(...a); } finally { bulkDepth--; }
};
if (typeof realGetMany === 'function') globalThis.shadow_get_params = wrapBulk(realGetMany);
if (typeof realSetMany === 'function') globalThis.shadow_set_params = wrapBulk(realSetMany);

await import('../dist/esm/app/globals.js');
const { appState, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
const { resetSeqState } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
const { sessionReady } = await import('../dist/esm/seq/set-session.js');
const { setFlag } = await import('../dist/esm/seq/flags.js');

/* TICKS ARE COUNTED HERE, IN THE ONE PLACE THAT ADVANCES THEM. A window's span
 * has to be MEASURED rather than assumed, because `before()` runs inside the
 * measured region and drives ticks of its own — see `window_` below. */
let ticks = 0;
const advance = (n) => { for (let i = 0; i < n; i++) { globalThis.tick(); ticks++; } };
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
 * SILENTLY — which is the whole failure above.
 *
 * THE 400 IS NOT A DURATION, and an earlier version of this comment said it was.
 * It claimed 400 ticks had to outlast a 1.5 s WALL-CLOCK Set-commit press "by
 * orders of magnitude" — but this file disables that press itself, ten lines up:
 * `setFlag('setcommit', 0)` makes set-commit.ts:153 return before it ever reaches
 * `phase = 'waiting'`, so the press never enters the state machine and the
 * wall-clock timeout it would have waited on never runs. The arithmetic was
 * inverted as well: 400 microsecond-ticks is ~0.4 ms against 1.5 s, three orders
 * of magnitude SHORT, not clear.
 *
 * What the loop is actually sized against is the settle completing at all — it
 * promotes to `phase = 'ready'` in a handful of ticks under the mock (the run
 * logs "set ready after 3ms"), so 400 is margin against a slow start rather than
 * against a clock. The one wall-clock bound genuinely left on that path is
 * `CAP_MS = 10000` in src/seq/set-settle.ts:24, and it is a backstop for a
 * migration that never resolves: it promotes rather than blocks, and at 10 s it
 * cannot fire inside 400 mock ticks. If the loop ever IS too short, the failure
 * is the exit(3) below — a refusal, not a plausible figure. */
for (let i = 0; i < 400 && !sessionReady(); i++) advance(1);
if (!sessionReady()) {
    console.error('grid-call-cost: movy never went live, so the input gate would void every gesture — refusing to print a number');
    process.exit(3);
}
advance(20);

/* THE TWO WINDOWS MUST SPAN THE SAME NUMBER OF TICKS, AND THAT SPAN IS MEASURED.
 *
 * The first version took a nominal `ticks` and advanced exactly that many AFTER
 * `before()` — but `before()` drives the gestures, and `playGesture` advances
 * SETTLE_TICKS itself, so the gesture window really spanned 600 ticks against an
 * idle window of 300 and the subtraction removed HALF an idle floor. Both arms
 * carried the same inflation, which is exactly why it read as a healthy ratio;
 * the tell was the gesture row's own `calls/tick`, a 600-tick count divided by
 * 300. The consequence was not cosmetic: the check reduced to an absolute ceiling
 * on page's premium, so a regression that DOUBLED the real page gesture cost
 * landed inside the budget and passed.
 *
 * Driving the span from the counter is what makes this unrepeatable: `before()`
 * can do as much work as it likes and the window still ends at the same span as
 * its control, and `perTick` divides by what actually elapsed rather than by a
 * constant nobody re-derived. */
function window_(label, before) {
    gets = 0; sets = 0; trips = 0;
    const start = ticks;
    if (before) before();
    const spent = ticks - start;
    if (spent < WINDOW_TICKS) advance(WINDOW_TICKS - spent);
    const span = ticks - start;
    const total = gets + sets;
    return { label, span, gets, sets, total, trips, perTick: total / span,
             tripsPerTick: trips / span };
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
/*
 * THE GESTURES ARE SPACED ON A WALL CLOCK, AND WITHOUT THAT THE PAGE ARM
 * MEASURES A GESTURE NOBODY CAN MAKE.
 *
 * Schwung's controller throttles its own setParam on Date.now
 * (SETPARAM_THROTTLE_MS = 20 in param_pages/page_controller.mjs): a write
 * inside the window is not lost, it is parked in pendingWrite and flushed by a
 * later tick or by the knob release. Ticks here are instant, so all 20 gestures
 * used to land inside one millisecond and 16 of their 20 writes collapsed into
 * their neighbours — the page arm reported 4 writes for 20 gestures and a
 * premium of 7, against `off`'s 20 writes. Measured 2026-09-16: stepping the
 * clock 40 ms per gesture takes the same 20 gestures to 40 writes and the
 * premium to 43, deterministic across five runs on each arm.
 *
 * 40 and not 20: the throttle compares `>=`, so a step ON the window is a
 * coin-flip against whatever real time the run spent, and a measurement sitting
 * on a boundary is not one. Two windows is clear of it with nothing to tune.
 *
 * It is a VIRTUAL clock added to the real one rather than a frozen one, because
 * movy's own wall-clock paths (set-settle's CAP_MS, the hint timers) must keep
 * seeing time move forward. `off` is unaffected either way — measured at
 * −418 with the step and without it — which is what says this models
 * Schwung's throttle and not something of movy's.
 */
const GESTURE_GAP_MS = 40;
let vclock = 0;
const realNow = Date.now;
Date.now = () => realNow() + vclock;
/* 20 gestures advance 300 ticks of their own, so the window is 600: that span
 * plus an equal tail. The idle floor is then measured over the same 600, and the
 * two windows differ by the input and nothing else — which is what the comment
 * below always claimed and the code did not do. */
const WINDOW_TICKS = GESTURES * SETTLE_TICKS * 2;

function playGesture(i) {
    const up = i % 2 === 0;
    sendMidi([0x90, globalThis.MoveKnob1Touch, 0x7f]);   /* hand on the knob */
    sendMidi(up ? FLICK_UP : FLICK_DOWN);
    sendMidi([0x80, globalThis.MoveKnob1Touch, 0x00]);
    sendMidi(up ? JOG_FWD : JOG_BACK);
    vclock += GESTURE_GAP_MS;
    advance(SETTLE_TICKS);
}

/* Two windows, and the difference between them is the gesture's cost. The
 * control window is the same SPAN and the same code path minus the input, so
 * what it subtracts is the idle refresh and nothing else — both spans are now
 * measured and printed, so a reader can check that claim instead of trusting it. */
const idle    = window_('idle');
const gesture = window_('gesture', () => {
    for (let i = 0; i < GESTURES; i++) playGesture(i);
});

/* THE GESTURE PREMIUM. The idle floor is shared by both arms, so subtracting it
 * leaves the calls the gesture actually added — a ratio of the two arms' TOTALS
 * would be dominated by that shared floor (measured: 2.71, and the mutation
 * below moves it to 2.80, i.e. no signal at all).
 *
 * IT IS REPORTED AS MEASURED, negative included. An input SUPPRESSES movy's
 * refresh window, so an arm whose gesture adds nothing comes out BELOW its own
 * idle floor — `off` measures −418 — and that is a finding rather than a glitch.
 * Whoever divides by it is the one who has to decide what a negative denominator
 * means; clamping it here would hide it from the human table too.
 *
 * AND THE PREMIUM IS ONLY A DELTA IF BOTH WINDOWS SPAN THE SAME NUMBER OF TICKS.
 * That is the one thing that can be silently wrong here, and it was: see the
 * measured-span note on `window_` above. */
const premium = gesture.total - idle.total;
const mode = schwungGridMode();

/* THE SPANS MUST MATCH, AND THEY ARE PRINTED BESIDE THE COUNTS. They were once
 * wrong by 2x and the only reason anyone noticed is that `calls/tick` on the
 * gesture row did not agree with the count on the same line. Two equal spans is
 * the invariant; rows that disagree mean a broken harness, not a result, and the
 * number below would be a floor of the wrong size subtracted from a real one. */
if (idle.span !== gesture.span) {
    console.error(`grid-call-cost: the windows span ${idle.span} and ${gesture.span} ticks — the subtraction removes a floor of the wrong size, refusing to print a number`);
    process.exit(4);
}

console.log(`arm=${ARM}  mode=${mode}  pages=${m.getBankCount()}  knobPage=${m.getKnobPage()}`);
for (const w of [idle, gesture]) {
    console.log(`  ${w.label.padEnd(12)} span=${String(w.span).padStart(4)}`
              + ` gets=${String(w.gets).padStart(5)} sets=${String(w.sets).padStart(3)}`
              + `  total=${String(w.total).padStart(5)}  calls/tick=${w.perTick.toFixed(2)}`
              + `  trips=${String(w.trips).padStart(5)}  trips/tick=${w.tripsPerTick.toFixed(3)}`);
}
console.log(`  ${GESTURES} gestures: ${premium} calls over the idle floor`
          + `  (${(premium / GESTURES).toFixed(2)} per gesture)`);

/* THE ONE MACHINE-READABLE LINE, read by browser-test/grid-cost.mjs and by
 * nothing else: the human table above is the part most likely to be reworded by
 * a later reader, and a suite that parsed it would break on a column change.
 * `calls` is the gesture premium for the whole window — a plain count of host
 * calls, no rounding and no division, so the suite can compare the two arms
 * without either of them losing a digit. `gap` travels beside it because the
 * ceiling is only valid for the gesture CADENCE it was derived at: with the
 * spacing removed the same code measures 7 instead of 43, which would sail
 * under any ceiling and look like a win. `mode` is the mode that ACTUALLY ran:
 * with no schwung checkout `page` pins itself to `off`, and an arm reporting
 * only what it was ASKED for would let two identical runs read as an A/B. */
/* `idletrips` is the IDLE floor in round trips, not a premium: what SP-26
 * changed is what a delegated page costs when NOTHING is happening — Schwung's
 * cursor asking one key a tick, every tick, for as long as the page is on
 * screen. A premium cannot see it (it is in both windows and subtracts out),
 * which is exactly how a page that quietly went back to one trip a tick would
 * pass every check in this file. */
console.log(`grid-cost: arm=${ARM} mode=${mode} calls=${premium} gap=${GESTURE_GAP_MS}`
          + ` idletrips=${idle.trips} span=${idle.span}`);
