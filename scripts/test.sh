#!/usr/bin/env bash
# test.sh — deploy movy and verify end-to-end behaviour on device
#
# Checks:
#   1. SSH reachability
#   2. Deploy
#   3. Movy loads (init ran, loadHierarchy ran)
#   4. Knob CCs reach the model and set params
#   5. Jog wheel CC reaches changePage (bank switching)
#   6. If a real synth is loaded: chain_params read + config looked up
#
# Requires schwung-midi-inject-ui.py one directory up.
# Usage: ./scripts/test.sh [host]   (default: move.local)

set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"

# Run against the fixture state rather than whatever the device happens to hold,
# so this passes standalone and in any order relative to the other suites.
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin || { echo "could not establish the fixture state"; exit 1; }
# Hand the LEDs back when this run ends, however it ends: the suites leave movy
# open in overtake owning the surface, so without this the hardware stays dark.
trap test_set_end EXIT INT TERM

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${YLW}→${RST} $1"; }
FAILURES=0

# ── 1. Pre-flight ────────────────────────────────────────────────────────────
info "Checking SSH ($HOST)..."
ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || {
    echo -e "${RED}Cannot reach $HOST${RST}"; exit 1; }
pass "SSH reachable"

# ── 2. Deploy ────────────────────────────────────────────────────────────────
# All movy logic is in ui.js (inlined) — shadow_load_ui_module re-evaluates
# ui.js fresh on every tool open, so no module-cache issues.
info "Building and deploying..."
cd "$MOVY_DIR"
node build/device.mjs >/dev/null 2>&1
REMOTE="/data/UserData/schwung/modules/tools/movy"
ssh "ableton@$HOST" "mkdir -p $REMOTE" >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE/"
# module.json too: capabilities (skip_led_clear, suspend_self_managed, …) live
# here and change how the host drives movy. Shipping only ui.js left the device
# running whatever capabilities it happened to have, so a capability change was
# invisible to this harness.
scp -q "$MOVY_DIR/module.json" "ableton@$HOST:$REMOTE/"
pass "Built + deployed"

# ── 3. Enable logging + clear log ────────────────────────────────────────────
ssh "ableton@$HOST" '
    touch /data/UserData/schwung/debug_log_on
    > /data/UserData/schwung/debug.log
' >/dev/null 2>&1
pass "Debug log enabled and cleared"

info "Opening Movy on device..."
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
sleep 1.5   # allow fresh JS context + init + first hierarchy poll
# movy opens on schwung's focused slot, which is device state this suite does
# not own. The fixture's synth is on track 0, and every check below reads that
# track's params — on any other slot they read an empty chain and the suite
# reports feature failures that are really state drift.
ts_focus_track0
pass "Movy opened fresh"

# ── 5. Inject knob turns ─────────────────────────────────────────────────────
info "Injecting knob CCs..."
python3 "$INJECT" "$HOST" cc 71 65   # knob 1 +1
sleep 0.15
python3 "$INJECT" "$HOST" cc 71 63   # knob 1 -1
sleep 0.15
python3 "$INJECT" "$HOST" cc 72 65   # knob 2 +1
sleep 0.2

# ── 6. Inject jog wheel turn (CC14, value 1 = one step clockwise) ────────────
info "Injecting jog wheel turn (bank switch)..."
python3 "$INJECT" "$HOST" cc 14 1
sleep 0.2
python3 "$INJECT" "$HOST" cc 14 1    # second step — tests clamping at bank boundary
sleep 0.3

# ── 6b. Wait for perf log entries (condition-based, not a fixed guess) ───────
# The tick-rate sample emits every NAME_POLL_TICKS (344) ticks, and the FIRST
# emission needs two windows (the first has no baseline to diff). The 344-tick
# poll was calibrated for ~344 Hz, but the device actually ticks ~80–110 Hz, so
# the first perf line lands ~7–9 s after open — far past any short fixed sleep.
# Poll for the line instead of guessing a delay (the fixed 1.5 s raced/flaked).
info "Waiting for perf log entries (polling up to ~15 s)..."
for _ in $(seq 1 30); do
    ssh "ableton@$HOST" 'grep -q "perf_tick_rate=" /data/UserData/schwung/debug.log' 2>/dev/null && break
    sleep 0.5
done

# ── 6c. Park + resume ────────────────────────────────────────────────────────
# The host zeroes overtake_suppress_sysex when we park and resumeOvertakeModule
# never re-applies it, while init() is not re-run — so LED ownership has to be
# re-claimed from onResume or Move's RGB repaints come back after the first
# Back. Park is a modal, not a bare Back: Back at the root Chain view opens the
# Leave-Movy modal, whose default selection is already Background, and jog click
# confirms. Resume is the same open_tool_cmd write used to open movy above.
info "Parking movy to background..."
python3 "$INJECT" "$HOST" cc 51 127   # MoveBack — opens the Leave-Movy modal
sleep 0.4
python3 "$INJECT" "$HOST" cc 3 127    # MoveMainButton (jog click) — confirm
sleep 1.2

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

# ── 7. Fetch log ─────────────────────────────────────────────────────────────
LOG=$(ssh "ableton@$HOST" 'grep "\[movy\]" /data/UserData/schwung/debug.log 2>/dev/null || true')

echo ""
echo -e "${BLD}=== Movy log ===${RST}"
if [[ -n "$LOG" ]]; then
    echo "$LOG"
else
    echo "(no [movy] lines found)"
fi
echo ""

# ── 8. Evaluate ──────────────────────────────────────────────────────────────
echo -e "${BLD}=== Results ===${RST}"

# Init
if echo "$LOG" | qgrep "init: activeTrack="; then
    SLOT=$(echo "$LOG" | grep "init: activeTrack=" | tail -1 | grep -o "activeTrack=[0-9]*" | cut -d= -f2)
    pass "Module loaded — opened on track $SLOT, then focused track 1"
else
    fail "init never ran (syntax error or path issue?)"
fi

# Hierarchy load
#
# The fixture puts a real synth on track 0, so "no synth loaded" is a FAILURE
# here rather than an outcome — it is precisely what a fixture that never
# reached the track's host looks like, which is the whole risk when the host is
# movy's own chains instead of schwung's slots. `ui_hierarchy null` still shows
# up LATER in the log, because the jog injections above walk the chain cursor
# onto an empty FX slot; what has to be true is that the fixture's synth loaded
# at some point.
#
# Two lines say so, one per hierarchy path: a module with a bundled movy config
# (src/modules/*.json) reports `config for <id>`, one without reports the
# generic `<n> params, <n> banks`. The check knew only the generic form plus a
# third phrase that no longer exists anywhere in src — so plaits, which HAS a
# config, fell through to the "no synth" branch and passed while proving nothing.
SYNTH=$(ts_fixture_synth 0)
if echo "$LOG" | qgrep "loadHierarchy:"; then
    if echo "$LOG" | qgrep -E "loadHierarchy: config for $SYNTH,|loadHierarchy: [0-9]+ params,"; then
        pass "Hierarchy loaded for the fixture's synth ('$SYNTH')"
    else
        fail "the fixture's synth ('$SYNTH') never loaded a hierarchy — track 0's host has no instrument"
    fi
else
    fail "loadHierarchy never called"
fi

# The module's own metadata, read off the live chain. Empty here is the failure
# mode behind "knobParams empty at knob turn time" below.
if echo "$LOG" | qgrep "loadHierarchy: chain_params"; then
    N=$(echo "$LOG" | grep "loadHierarchy: chain_params" | tail -1 | grep -o "[0-9]* entries" | awk '{print $1}')
    pass "chain_params read from the module — $N entries"
else
    fail "chain_params never read — the module served no metadata"
fi

# Knob CCs
if echo "$LOG" | qgrep "knobCC k="; then
    N=$(echo "$LOG" | grep -c "knobCC k=" || true)
    pass "Knob CCs received ($N events)"
else
    fail "No knob CCs received"
fi

# set_param
if echo "$LOG" | qgrep "^.*set slot="; then
    pass "applyKnobDelta ran — param write attempted"
    if echo "$LOG" | qgrep "set_param returned true"; then
        pass "shadow_set_param returned true — IPC OK"
    elif echo "$LOG" | qgrep "set_param returned false"; then
        fail "shadow_set_param returned false — IPC timeout or key rejected"
    else
        # The fallback test params are what movy shows with NO synth on the
        # track, and the fixture guarantees one — so reaching here means the
        # knob turn never became a param write at all.
        fail "no IPC for the knob turn — the fallback test params were on screen"
    fi
else
    if echo "$LOG" | qgrep "no param\|empty slot"; then
        fail "applyKnobDelta: knobParams empty at knob turn time"
    else
        fail "applyKnobDelta never reached"
    fi
fi

# Jog wheel — chain navigation or page change
if echo "$LOG" | qgrep "chain chainIndex="; then
    IDX=$(echo "$LOG" | grep "chain chainIndex=" | tail -1 | grep -o "chainIndex=[0-9]*" | cut -d= -f2)
    pass "Jog wheel CC navigates chain — chainIndex=$IDX"
elif echo "$LOG" | qgrep "changePage delta="; then
    PLINE=$(echo "$LOG" | grep "changePage delta=" | head -1 | sed 's/.*\[movy\] //')
    pass "Jog wheel CC reaches changePage — $PLINE"
else
    fail "Jog wheel CC not received (CC14 not reaching onMidiMessageInternal)"
fi

# LED ownership must survive a park/resume — see section 6c.
CLAIMS=$(echo "$LOG" | grep -c "LED ownership claimed" || true)
if [[ "$CLAIMS" -ge 2 ]]; then
    pass "LED ownership re-claimed on resume ($CLAIMS claims)"
elif echo "$LOG" | qgrep "resume from background"; then
    fail "LED ownership not re-claimed on resume (claims=$CLAIMS, expected >=2)"
else
    fail "movy never parked/resumed — park injection did not land (claims=$CLAIMS)"
fi

# Knob LEDs
if echo "$LOG" | qgrep "knobLED k="; then
    SAMPLE=$(echo "$LOG" | grep "knobLED k=0 " | tail -1 | sed 's/.*\[movy\] //')
    pass "Knob LEDs firing — $SAMPLE"
else
    fail "updateKnobLEDs never ran (knobLED log line absent)"
fi

# ── 8b. Performance checks ───────────────────────────────────────────────────
# These catch regressions in tick rate and IPC blocking without requiring
# instrumented builds — the timing is logged by processTick every cycle.

# Tick rate: a coarse "not starved" floor. The overtake loop targets ~500 Hz
# (usleep 2 ms) but the schwung host caps it far lower, and a heavy co-running
# synth DSP (e.g. Surge, 80 params) drags the achievable rate to ~80 Hz — this
# was verified identical on a pre-feature build, so it is device/DSP load, not a
# movy regression. The precise blocking guard is REFRESH_MS_MAX below; this floor
# only catches catastrophic starvation, so it sits below the heavy-DSP baseline.
# We read the MAX sample (best window) to shrug off per-window scheduling noise.
TICK_RATE_MIN=60

# Refresh blocking: each tick calls refreshOneParam() — one shadow_get_param.
# Baseline: ~3 ms per GET. Threshold 10 ms allows for shim jitter. This is the
# real per-tick blocking detector (any single sample over threshold fails).
REFRESH_MS_MAX=10

if echo "$LOG" | qgrep "perf_tick_rate="; then
    RATE=$(echo "$LOG" | grep "perf_tick_rate=" | grep -o "perf_tick_rate=[0-9]*" | cut -d= -f2 | sort -n | tail -1)
    if [[ -n "$RATE" ]] && (( RATE >= TICK_RATE_MIN )); then
        pass "Tick rate ${RATE} ticks/sec (max) >= ${TICK_RATE_MIN} (threshold)"
    elif [[ -n "$RATE" ]]; then
        fail "Tick rate ${RATE} ticks/sec is below threshold ${TICK_RATE_MIN} — possible blocking"
    else
        fail "Could not parse perf_tick_rate value"
    fi
else
    fail "perf_tick_rate not found in log — timing instrumentation missing or not reached"
fi

if echo "$LOG" | qgrep "perf_refresh_ms="; then
    # Check all refresh samples in the log — all must be below threshold.
    REFRESH_FAILURES=0
    REFRESH_MAX_SEEN=0
    while IFS= read -r line; do
        MS=$(echo "$line" | grep -o "perf_refresh_ms=[0-9]*" | cut -d= -f2)
        [[ -z "$MS" ]] && continue
        (( MS > REFRESH_MAX_SEEN )) && REFRESH_MAX_SEEN=$MS
        (( MS > REFRESH_MS_MAX )) && REFRESH_FAILURES=$((REFRESH_FAILURES + 1))
    done < <(echo "$LOG" | grep "perf_refresh_ms=")

    if (( REFRESH_FAILURES == 0 )); then
        pass "Refresh blocking ${REFRESH_MAX_SEEN} ms max <= ${REFRESH_MS_MAX} ms (threshold)"
    else
        fail "Refresh blocking ${REFRESH_MAX_SEEN} ms max — ${REFRESH_FAILURES} sample(s) exceed ${REFRESH_MS_MAX} ms"
    fi
else
    fail "perf_refresh_ms not found in log — timing instrumentation missing or refresh not triggered"
fi

# ── 9. Summary ───────────────────────────────────────────────────────────────
echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GRN}${BLD}ALL CHECKS PASSED${RST}"
else
    echo -e "${RED}${BLD}$FAILURES CHECK(S) FAILED${RST}"
    echo -e "Live log: ${YLW}ssh ableton@$HOST 'tail -f /data/UserData/schwung/debug.log | grep \\[movy\\]'${RST}"
    exit 1
fi
