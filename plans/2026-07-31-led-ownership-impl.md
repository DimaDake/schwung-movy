# LED Ownership Under Overtake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make movy own 100% of the Move control surface's LEDs while it is the active overtake tool, identically on first load and after every park/resume.

**Architecture:** Three independent changes. (1) Remove the vestigial `skip_led_clear` capability from `module.json` so the framework's LED-strip loop actually runs. (2) Extract the framework LED-ownership call into `src/app/led-ownership.ts` and invoke it from both `init()` and `onResume()`, since the framework clears its flags at park and never re-applies them. (3) Give `updateKnobLEDs()` a movy-owned diff cache so it stops force-writing 16 LEDs every tick.

**Tech Stack:** TypeScript → ESM (`npm run build:browser` → `dist/esm`), Node-based test suites in `browser-test/*.mjs`, device e2e via `scripts/test.sh` / `scripts/test-seq.sh`.

**Design doc:** `plans/2026-07-31-led-ownership-design.md` (read it first — it carries the framework line references and the reasoning behind keeping `force=true`).

## Global Constraints

- Work in `/Users/dake/git/cld/movy`. Never modify `schwung/`, `schwung-davebox/`, or `schwung-midi-inject-ui.py`.
- Framework calls must stay guarded with `typeof fn === 'function'` — movy must keep running on hosts that predate `shadow_set_overtake_suppress_sysex`.
- Comments explain WHY (constraints, invariants, workarounds), never WHAT the code literally does.
- No code duplication. Refactor into a shared location before proceeding.
- `git add <specific files>` only. Never `git add -A`.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- Full local suite before any push: `npm test` (builds, then runs `logic.mjs`, `app-loop.mjs`, `screenshot.mjs`, `perf.mjs`). Zero failures required.
- The Rust engine is untouched by this work — skip `cargo test`.

---

### Task 1: LED ownership is claimed on init *and* on resume

Fixes design-doc Defect 2. Done first because Task 2 (`skip_led_clear` removal) is what makes the claim actually take effect — if the order were reversed, the window between commits would have a live strip loop with suppression lost after the first park.

**Files:**
- Create: `src/app/led-ownership.ts`
- Modify: `src/app/init.ts:17-27` (replace the inline call with the shared one)
- Modify: `src/app/resume.ts` (add the call)
- Test: `browser-test/logic.mjs` (append a new test block near the other `init()`-driven tests, around line 5545)

**Interfaces:**
- Produces: `claimLedOwnership(): void` exported from `src/app/led-ownership.ts`. Consumed by `src/app/init.ts` and `src/app/resume.ts`. Takes no arguments, returns nothing, safe to call repeatedly.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`, after the "LFO chain slot wiring" block (~line 5558):

```js
/* ── LED ownership is re-claimed on resume ────────────────────────────────── */

_log('\nTest: LED ownership claimed on init and on resume');
{
    const { onResume } = await import('../dist/esm/app/resume.js');

    let claims = 0;
    const origClaim = globalThis.shadow_set_overtake_suppress_sysex;
    globalThis.shadow_set_overtake_suppress_sysex = (flag) => { if (flag === 1) claims++; };

    env.setParams({});
    init();
    eq('init claims LED ownership', claims, 1);

    /* The framework zeroes overtake_suppress_sysex at park and never restores
     * it, and init() is not re-run on resume — so onResume must re-claim. */
    onResume();
    eq('resume re-claims LED ownership', claims, 2);

    globalThis.shadow_set_overtake_suppress_sysex = origClaim;
}
```

Note: `logic.mjs` is an ESM module, so the top-level `await import(...)` is legal. If a static import is preferred for consistency with the file's style, add `import { onResume } from '../dist/esm/app/resume.js';` to the import block at the top instead and drop the dynamic import line.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dake/git/cld/movy
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A3 "LED ownership"
```

Expected: FAIL on `resume re-claims LED ownership: expected 2, got 1`. The `init` assertion already passes — `init.ts` makes the call today. This is the point: the test has teeth only on the resume half, which is the actual bug.

- [ ] **Step 3: Create the shared module**

Create `src/app/led-ownership.ts`:

```ts
import { mlog } from '../log.js';

/* Move paints its RGB pads, steps and grid with cable-0 LED sysex. Full
 * overtake strips its note and CC LED writes but not sysex, so with the Play
 * link on — Move's sequencer still running — its repaints land on top of ours
 * and stick: our LED layer only sends colours that changed, so a step Move
 * painted is never corrected. Resending cannot win against a peer that
 * repaints continuously, so take the sysex away from it (schwung
 * docs/CORUN.md).
 *
 * Must be re-claimed on every resume, not just at init: the framework zeroes
 * overtake_suppress_sysex when we park (schwung shadow_ui.js:3180-3187) and
 * resumeOvertakeModule never re-applies it, while init() is not re-run. */
export function claimLedOwnership(): void {
    if (typeof shadow_set_overtake_suppress_sysex === 'function') {
        shadow_set_overtake_suppress_sysex(1);
        mlog('LED ownership claimed (overtake sysex suppression on)');
    }
}
```

- [ ] **Step 4: Call it from init**

In `src/app/init.ts`, delete the inline block at lines 17-27 (the comment plus the `if (typeof shadow_set_overtake_suppress_sysex === 'function') { ... }`) and replace with:

```ts
    claimLedOwnership();
```

Add to the import block at the top of the file:

```ts
import { claimLedOwnership } from './led-ownership.js';
```

- [ ] **Step 5: Call it from resume**

`src/app/resume.ts` becomes:

```ts
import { invalidateLedCachesOnResume } from './tick.js';
import { claimLedOwnership } from './led-ownership.js';
import { mlog } from '../log.js';

/* Called by the host once each time movy returns from background (parked →
 * resumed). init() is NOT re-run. Our on-change LED/screen caches went stale
 * while the sequencer advanced under Move's native UI, so force a full repaint
 * — and re-claim LED ownership, which the framework dropped when we parked. */
export function onResume(): void {
    mlog('resume from background');
    claimLedOwnership();
    invalidateLedCachesOnResume();
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A3 "LED ownership"
```

Expected: both assertions PASS.

- [ ] **Step 7: Prove the test has teeth**

Temporarily remove the `claimLedOwnership();` line from `src/app/resume.ts`, rebuild, re-run. Expected: FAIL on the resume assertion. Restore the line, rebuild, confirm PASS again. Do not commit the broken state.

- [ ] **Step 8: Run the full local suite**

```bash
npm test
```

Expected: 0 failures across all four suites.

- [ ] **Step 9: Commit**

```bash
git add src/app/led-ownership.ts src/app/init.ts src/app/resume.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Re-claim LED ownership when returning from background

The framework zeroes overtake_suppress_sysex at park and resume never puts it
back, while init() is not re-run — so movy lost sysex suppression after the
first Back-park cycle and Move's RGB repaints returned. One shared claim, made
from both entry points.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Drop the vestigial `skip_led_clear` capability

Fixes design-doc Defect 1 — the change that actually stops the pollution.

**Files:**
- Modify: `module.json` (the `capabilities` object)
- Test: no new local test — see the note below

**Interfaces:**
- Consumes: `claimLedOwnership()` from Task 1 must already be in place, otherwise suppression is still lost after the first park.
- Produces: nothing consumed by later tasks.

**Why no local test:** the strip loop lives in schwung's C (`shadow_clear_move_leds_if_overtake`, `src/host/shadow_led_queue.c:427`), not in movy. No movy suite can reproduce or observe it. Per CLAUDE.md ("match the test to the bug — cheapest level that reproduces it, and stop there"), a movy-side test asserting the *absence* of a JSON key would assert the diff, not the behaviour — churn, not coverage. Verification for this task is the device run in Task 4.

- [ ] **Step 1: Remove the capability**

In `module.json`, change:

```json
    "capabilities": {
        "skip_led_clear": true,
        "claims_master_knob": true,
        "suspend_self_managed": true
    }
```

to:

```json
    "capabilities": {
        "claims_master_knob": true,
        "suspend_self_managed": true
    }
```

Leave `claims_master_knob` and `suspend_self_managed` alone — the volume gesture and background mode are explicitly out of scope.

- [ ] **Step 2: Confirm nothing in movy reads the flag**

```bash
grep -rn "skip_led_clear" src/ browser-test/ scripts/ build/
```

Expected: no output. The capability was only ever consumed by the host.

- [ ] **Step 3: Run the full local suite**

```bash
npm test
```

Expected: 0 failures. `module.json` is not read by the local suites, so this is a regression check, not a verification of the change.

- [ ] **Step 4: Commit**

```bash
git add module.json
git commit -m "$(cat <<'EOF'
Stop opting out of the framework's LED suppression

skip_led_clear makes the host return before the loop that strips Move's LED
writes, so Move's notes, CCs and RGB sysex all reached the hardware and the
suppress_sysex opt-in was inert. The flag dates to v0.1.0, when movy overlaid
Move's clip colours; sessionPaintGrid and the chromatic layout have painted
every pad themselves for a long time now.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Give knob LEDs a diff cache

**Files:**
- Modify: `src/renderer/knob-leds.ts` (add cache + reset export; `updateKnobLEDs` at line 26)
- Modify: `src/app/tick.ts:181-191` (`invalidateLedCachesOnResume` clears the new cache)
- Test: `browser-test/logic.mjs` (append after the Task 1 test block)

**Interfaces:**
- Produces: `resetKnobLedCache(): void` exported from `src/renderer/knob-leds.ts`. Consumed by `invalidateLedCachesOnResume()` in `src/app/tick.ts`. Takes no arguments, returns nothing.
- `updateKnobLEDs(vm: ViewModel): void` keeps its existing signature.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`, after the Task 1 block:

```js
/* ── Knob LEDs are sent on change only ────────────────────────────────────── */

_log('\nTest: knob LEDs diff against a movy-owned cache');
{
    const { updateKnobLEDs, resetKnobLedCache } =
        await import('../dist/esm/renderer/knob-leds.js');

    let sends = 0;
    const origSetLED = globalThis.setLED;
    const origSetButtonLED = globalThis.setButtonLED;
    globalThis.setLED = () => { sends++; };
    globalThis.setButtonLED = () => { sends++; };

    const cell = (nv) => ({ normalizedValue: nv, trigger: null });
    const vmAt = (nv) => ({ rows: [
        [cell(nv), cell(nv), cell(nv), cell(nv)],
        [cell(nv), cell(nv), cell(nv), cell(nv)],
    ] });

    resetKnobLedCache();

    updateKnobLEDs(vmAt(0.1));
    eq('cold frame writes all 16 knob LEDs', sends, 16);

    sends = 0;
    updateKnobLEDs(vmAt(0.1));
    eq('unchanged frame writes nothing', sends, 0);

    /* 0.1 and 0.9 land in different whiteLevel/amberLevel bands, so every
     * knob's colour actually changes. */
    sends = 0;
    updateKnobLEDs(vmAt(0.9));
    eq('changed frame writes all 16 again', sends, 16);

    /* Resume invalidation must force a cold frame — the framework's entry
     * LED-clear repaints hardware without going through our cache. */
    sends = 0;
    resetKnobLedCache();
    updateKnobLEDs(vmAt(0.9));
    eq('reset forces a full repaint', sends, 16);

    globalThis.setLED = origSetLED;
    globalThis.setButtonLED = origSetButtonLED;
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A6 "knob LEDs diff"
```

Expected: FAIL — the import of `resetKnobLedCache` is undefined, and `unchanged frame writes nothing` reports 16 instead of 0.

- [ ] **Step 3: Add the cache to knob-leds**

In `src/renderer/knob-leds.ts`, add above `updateKnobLEDs`:

```ts
/* Our own diff cache, not schwung's. setLED/setButtonLED come from
 * input_filter.mjs, whose module-level cache we cannot invalidate — and the
 * host's overtake entry LED-clear writes straight through
 * move_midi_internal_send without updating it. Any path where that cache
 * outlives a hardware clear would leave it claiming a colour the knob no
 * longer shows. So we keep force=true to bypass it and diff here instead,
 * the same arrangement seq/led-cache.ts uses. */
const lastKnobColor = new Array(8).fill(-1);

/* Called from invalidateLedCachesOnResume — see the note above. */
export function resetKnobLedCache(): void {
    lastKnobColor.fill(-1);
}
```

Then in the inner loop of `updateKnobLEDs`, replace:

```ts
            /* notes 0-7: knob touch LEDs */
            setLED(physK, color, true);
            /* CC 71-78: knob indicator LEDs (same physical knob, different LED channel) */
            setButtonLED(MoveKnob1 + physK, color, true);
```

with:

```ts
            if (lastKnobColor[physK] !== color) {
                lastKnobColor[physK] = color;
                /* notes 0-7: knob touch LEDs */
                setLED(physK, color, true);
                /* CC 71-78: knob indicator LEDs (same physical knob, different LED channel) */
                setButtonLED(MoveKnob1 + physK, color, true);
            }
```

Also update the function's doc comment: the sentence *"force=true bypasses the LED cache so Move firmware's per-frame touch-state updates don't win"* is now wrong about the reason. Replace that sentence with:

```
 *  force=true bypasses schwung's setLED cache; we diff against our own
 *  (see lastKnobColor) so a host-side LED clear can never strand a knob dark.
```

- [ ] **Step 4: Clear the cache on resume**

In `src/app/tick.ts`, add to the import block:

```ts
import { updateKnobLEDs, resetKnobLedCache } from '../renderer/knob-leds.js';
```

(replacing the existing `import { updateKnobLEDs } from '../renderer/knob-leds.js';` at line 19)

and add one line inside `invalidateLedCachesOnResume()`:

```ts
    resetKnobLedCache();
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A6 "knob LEDs diff"
```

Expected: all four assertions PASS.

- [ ] **Step 6: Prove the test has teeth**

Temporarily revert the `if (lastKnobColor[physK] !== color)` guard (call `setLED`/`setButtonLED` unconditionally again), rebuild, re-run. Expected: FAIL on `unchanged frame writes nothing`. Restore, rebuild, confirm PASS.

- [ ] **Step 7: Run the full local suite**

```bash
npm test
```

Expected: 0 failures. Pay attention to `perf.mjs` — per-tick LED traffic should drop. If `app-loop.mjs` fails on an LED assertion, that is a genuine signal: some caller may depend on knob LEDs being re-sent every tick. Investigate rather than loosening the test.

- [ ] **Step 8: Regenerate screenshot baselines only if they actually moved**

LED writes are not framebuffer writes, so baselines are not expected to change. Only if `screenshot.mjs` reports diffs:

```bash
node browser-test/screenshot.mjs --update
```

and include the changed PNGs in the commit, noting in the message why they moved.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/knob-leds.ts src/app/tick.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Send knob LEDs on change instead of every tick

The unconditional 16 writes per tick existed to out-shout Move's repaints;
with the framework now stripping them, they are pure traffic. Diffing against
a movy-owned cache rather than schwung's keeps a host-side LED clear from
stranding a knob dark, so force=true stays.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Device verification

Nothing before this point verifies the actual behaviour — Task 2's fix is entirely host-side. This task is where the work is proven.

**Files:**
- Modify: `scripts/test.sh` (add the park/resume claim assertion — the harness has no park/resume coverage today)

**Interfaces:**
- Consumes: Tasks 1-3, all committed.

- [ ] **Step 1: Check device reachability**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && echo ONLINE || echo "DEVICE OFFLINE"
```

If offline: stop here, do not push, and **report to the user in CAPS** that device verification was skipped. Tasks 1-3 stay committed locally.

- [ ] **Step 2: Run the existing device suites**

```bash
./scripts/test.sh
./scripts/test-seq.sh
```

Expected: both pass. If either fails, re-run once before concluding it is pre-existing — a single failure is not evidence of a pre-existing break.

- [ ] **Step 3: Verify LED ownership survives a park/resume**

`claimLedOwnership()` logs `LED ownership claimed (overtake sysex suppression on)`. Automate open → park → resume in `scripts/test.sh` and assert the log records **two** claims. Do not ask the user to perform device gestures by hand.

The park path is a modal, not a bare Back (`src/midi/router.ts:80-97`, `src/app/leave-modal.ts`): Back at the root Chain view opens the Leave-Movy modal, whose default selection (`sel = 0`) is already **Background**; jog click confirms and calls `host_suspend_overtake()`. Resume is the same `open_tool_cmd` write the script already uses at line 50 to open movy — `loadOvertakeModule` detects the parked entry and routes to `resumeOvertakeModule`.

Add after the existing inject block, using the script's `$INJECT` / `$HOST` / `pass` / `fail` helpers:

```bash
# ── Park movy (Back → Leave modal → jog click confirms "Background") ─────────
info "Parking movy to background..."
python3 "$INJECT" "$HOST" cc 51 127   # MoveBack — opens the Leave-Movy modal
sleep 0.3
python3 "$INJECT" "$HOST" cc 3 127    # MoveMainButton (jog click) — confirm
sleep 1.0

# ── Resume via the same open_tool_cmd path used to open it ──────────────────
info "Resuming movy from background..."
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
cmd = json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"})
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(cmd)
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0)
    mm[56] = 1
    mm.close()
"'
sleep 1.5
```

Then, after the existing log fetch at line 93 (`$LOG` already holds the `[movy]`-filtered contents of `/data/UserData/schwung/debug.log`), assert:

```bash
CLAIMS=$(echo "$LOG" | grep -c "LED ownership claimed" || true)
if [ "$CLAIMS" -ge 2 ]; then
    pass "LED ownership re-claimed on resume ($CLAIMS claims)"
else
    fail "LED ownership not re-claimed on resume (claims=$CLAIMS, expected >=2)"
fi
```

Prove this assertion has teeth: remove `claimLedOwnership()` from `src/app/resume.ts`, redeploy, re-run, and confirm it reports 1 claim and fails. Restore before continuing.

Two things to confirm while wiring this up, rather than assuming:
- Back only opens the modal **at the root Chain view**. The injected knob/jog turns earlier in the script may have navigated elsewhere; if so, inject Back more than once, or park before those steps.
- `mm[56] = 1` is the `open_tool_cmd` byte offset copied from the script's existing open block. Reuse it verbatim rather than recomputing it.

- [ ] **Step 4: Measure the entry delay**

The framework gates init on `OVERTAKE_INIT_DELAY_TICKS = 30` (`schwung/src/shadow/shadow_ui.js:613`), commented "~500ms at 16ms tick". Don't trust the comment and don't rely on log timestamps — movy already logs the real figure. `src/model/tick.ts:77` emits `perf_tick_rate=<Hz>`, and `scripts/test.sh` already waits for that line:

```bash
RATE=$(echo "$LOG" | grep -o "perf_tick_rate=[0-9.]*" | tail -1 | cut -d= -f2)
echo "entry delay ≈ $(echo "scale=0; 30000 / $RATE" | bc) ms at ${RATE} Hz"
```

Report the measured figure to the user. Note the codebase disagrees with itself about tick rate — `scripts/test.sh:83` says ~80–110 Hz, other notes say higher — so measure, don't assume. At 80 Hz the delay is ~375 ms and at 110 Hz ~270 ms, both under the 500 ms the comment claims. If the measurement comes out materially above 500 ms, flag it: the user accepted the ceremony provisionally on the expectation that it is shorter.

- [ ] **Step 5: Confirm the pollution is gone**

With the Play link on and Move's sequencer running — the condition that made Move's repaints stick — check that pads, steps, and knob rings show only movy's colours, and that parking restores Move's own LEDs. This is the one genuinely visual check in the plan; capture what you observe.

- [ ] **Step 6: Update the docs**

Per CLAUDE.md, significant user-facing changes update `MANUAL.md`. Judge whether this qualifies: the visible changes are the brief "Loading…" on open and LEDs no longer bleeding through from Move. If MANUAL.md documents either behaviour, correct it. `CHANGELOG.md` should get an entry regardless. `README.md` only if this is treated as a headline fix.

- [ ] **Step 7: Push**

```bash
git push
```

---

## Notes for the implementer

- Task 1 must land before Task 2. Task 3 is independent of both but is written to assume Tasks 1-2 are in place; running it first would leave a diff cache competing with live Move repaints, which is the failure mode Task 3's cache comment describes.
- If pollution survives Tasks 1-2 on device, do **not** reach for `force=true` again. That is the workaround this work removes. Re-read `shadow_clear_move_leds_if_overtake` in `schwung/src/host/shadow_led_queue.c` and find which branch is being taken — the design doc has the exact ordering.
- `schwung/` was reset to `origin/main` (`4519d26d`, 2026-07-21) and configured `pull.ff only`. Re-read it there, not from memory, if you need framework detail.
