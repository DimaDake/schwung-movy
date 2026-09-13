#!/bin/bash
# measure-grid-cost.sh — what the Schwung param-page grid costs at the tick.
#
# The complaint this exists for is "knob turns and jog paging feel slower in the
# Schwung page arm, and jog ticks get swallowed". Both are the SAME
# measurement: movy's tick period IS its MIDI input sampling interval
# (process_shadow_midi runs once per loop, before tick), so anything that
# lengthens a tick coarsens input sampling. A gesture that blocks the tick for
# 200 ms does not just feel slow — it drops the CCs that arrived meanwhile.
#
# So this does not time the gesture. It reads `perf_ipc`, which reports
# calls/tick, ipc_ms, tick_ms and period_ms, while a gesture is injected — and
# it injects the gesture as ONE CC carrying a real magnitude, because that is
# how Move's encoders actually arrive. A flick is not sixty small turns.
#
# Run it once per arm and diff:
#   ./scripts/measure-grid-cost.sh off
#   ./scripts/measure-grid-cost.sh page
#
# The arm is the `schwunggrid` FLAG now, and this script writes it into the
# device's prefs and reopens movy to read it back. MOVY_SCHWUNG_GRID used to
# appear here and reaches NO build — the mode became the flag. Following those
# lines as written rebuilt `off` twice and reported no difference, which is the
# one result an A/B must not be able to fake.
#
# A STORED FLAG BEATS A CHANGED DEFAULT, which is the half of this that bites:
# `flagValue` reads prefs.json, so a value already written there wins over
# anything a build or a default says. An arm is therefore an edit to the device
# plus a reopen — never a rebuild — and a run that skips the edit measures
# whatever the last `page` run left behind.
#
# The device must already be sitting on a module knob page with a module
# loaded; an empty slot measures the fallback, not the grid.
set -u
HOST="${HOST:-move.local}"
ARM="${1:-unknown}"
LOG=/data/UserData/schwung/debug.log
OUT="${OUT:-/tmp/grid-cost-$ARM.txt}"
PREFS=/data/UserData/schwung/modules/tools/movy/prefs.json

sshd() { ssh "ableton@$HOST" "$@"; }

# The flag's values are the Settings row's order (src/renderer/schwung-grid.ts):
# 0 = MOVY, 1 = BODY, 2 = PAGE. There is no build that selects any of them.
case "$ARM" in
    off)  SCHWUNGGRID=0 ;;
    page) SCHWUNGGRID=2 ;;
    *)    echo "usage: measure-grid-cost.sh off|page" >&2; exit 2 ;;
esac

# One CC per token, 40 ms apart (inject-any.py's own pacing).
#   0e = jog turn, 47..4e = knobs 1..8, 90/80 = knob touch/release.
# Relative CC: 1..63 is +N, 65..127 is -N. A 20 (=32) is a hard flick.
# A DROPPED INJECT MUST NOT LEAVE AN EMPTY SECTION. The script runs `set -u`
# without `set -e`, and this body used to discard the stderr saying why, so a
# failed ssh left a section header with no numbers under it and nothing to explain
# them — which reads as "the grid costs nothing" rather than as a harness that
# never sent anything. Say it where the artifact is, not only on the terminal.
inject() {
    if ! sshd "python3 /data/UserData/inject-any.py $* >/dev/null 2>&1"; then
        echo "  INVALID: inject FAILED (ssh or python) — this section measured nothing: $*" >> "$OUT"
        echo "measure-grid-cost: inject failed for: $*" >&2
    fi
}

# perf_ipc reports every 120 ticks, so a window needs to span several reports.
#
# EVERY SAMPLE RECORDS WHICH VIEW IT MEASURED. The first version of this did
# not, and its five sections came back identical at ~5 ms — which read as "the
# grid costs nothing" and was really "the device was not on a module page".
# `schwung-view` and `schwung-body` are already logged once per change, and
# `schwung-body ok` is the only proof the grid drew the frame at all; a sample
# without one measured movy's own renderer whatever the flag was set to.
sample() {
    local label="$1"; shift
    sshd "> $LOG"
    "$@"
    sleep 3
    echo "--- $ARM / $label ---" >> "$OUT"
    # A VIEW CHANGE INVALIDATES THE SAMPLE. `schwung-view` logs only on change,
    # so a line here means the page moved under the measurement — the number
    # describes two views averaged, which is worse than no number.
    #
    # `grep -c` EXITS 1 WHEN THE COUNT IS ZERO, and `|| echo 0` therefore added a
    # SECOND `0` to its output: on a clean sample `moved` was the two-line string
    # "0\n0", which is not `0`, so every CLEAN sample was stamped INVALID and a
    # genuinely dirty one would have been the only one that was not. The test was
    # inverted. Strip the newline instead of appending a fallback.
    local moved
    moved=$(sshd "grep -c schwung-view $LOG | tr -d '[:space:]'")
    if [ "${moved:-0}" != "0" ]; then
        echo "  INVALID: the view changed ${moved}x during this sample" >> "$OUT"
        sshd "grep schwung-view $LOG" | tail -n 3 >> "$OUT"
    fi
    sshd "grep perf_ipc $LOG" | sed -E 's/.*perf_ipc //' >> "$OUT"
}

: > "$OUT"
sshd "test -f /data/UserData/schwung/debug_log_on || touch /data/UserData/schwung/debug_log_on"

# CLEAR THE LOG *BEFORE* THE REOPEN BELOW — the order is the whole reason the
# preflight can pass on BOTH arms. `mode=off` is a STABLE reason: schwung-body
# logs it once per process and a jog cannot make it re-log, so clearing anywhere
# after movy's first frame destroys the only proof the off arm will ever emit
# and the preflight ABORTs on "no schwung-body line at all" — which is exactly
# how the off arm failed the first time. Clearing first lets the reopen write
# its reason into an empty log, so both arms start the preflight with their
# reason already recorded.
sshd "> $LOG"

# SELECT THE ARM, THEN REOPEN MOVY. Read-modify-write, because unrelated
# preferences share the file: writing it whole would erase them, and `flags` may
# already hold other keys.
sshd "python3 -c '
import json
p = \"$PREFS\"
try:
    prefs = json.load(open(p))
except Exception:
    prefs = {}
prefs.setdefault(\"flags\", {})[\"schwunggrid\"] = $SCHWUNGGRID
json.dump(prefs, open(p, \"w\"))
'"

# REOPEN MOVY, or the write is invisible: the flags are read into a cache at
# init and only ever written through `setFlag`, so a prefs.json edited under a
# running movy changes nothing about the arm being measured. Same reopen the
# device tier uses (test-device/bus.ts openTool), as one ssh round trip. It is
# also what puts the arm's `schwung-body` reason into the log.
sshd 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"'
sleep 8

# PREFLIGHT: PROVE WHAT IS ON SCREEN BEFORE MEASURING ANYTHING.
#
# `schwung-body` logs once per distinct REASON, so a page sitting still emits
# nothing and "no line" is indistinguishable from "wrong view" — which is how
# a run that measured the empty-slot fallback came back as a flat 4.8 ms and
# read like "the grid is free". The `ok` reason embeds `at=<pageIndex>`, so a
# single jog and its undo force it to re-log. That is a positive signal.
#
# A movy CHAIN and a schwung SLOT are different param paths, and the complaint
# is about the chain one — schwung caches its slot reads, a movy chain's go
# through the engine. The preflight records which one this arm measured.
#
# THE LOG IS TRUNCATED BEFORE THE REOPEN ABOVE, NOT HERE, and that ordering is
# the whole reason this can pass on BOTH arms. `mode=off` is a STABLE reason: it
# is logged once per process and a jog cannot make it re-log, so a truncate
# anywhere after movy's first frame erases the only proof the off arm will ever
# emit. Clearing first and letting the reopen fill it means both arms begin the
# preflight with their reason already written down.
inject b0:0e:01 b0:0e:7f
sleep 2
WHERE=$(sshd "grep -oE 'schwung-body (ok track=[0-9]+ ck=[a-z_0-9:]+ pages=[0-9]+|not-ready[^|]*|mode=[a-z]+|no-model|step-page-selected)' $LOG | tail -n 1")
echo "== preflight: ${WHERE:-(no schwung-body line at all)}" | tee -a "$OUT"
case "$WHERE" in
    *"ok track="*) ;;                       # grid is drawing — the arm we want
    *mode=off*)    echo "   (flag-off arm: movy's own renderer, as intended)" | tee -a "$OUT" ;;
    *)  echo "ABORT: not on a module page with a module loaded — nothing to measure." >&2
        echo "       Park the device on the movy track's module page and re-run." >&2
        exit 2 ;;
esac

# 1. IDLE — the floor. Anything the grid costs per frame with no input shows here.
sample idle sleep 12

# 2. JOG PAGING — ten single-detent moves, alternating so the page returns.
sample jog inject b0:0e:01 b0:0e:01 b0:0e:01 b0:0e:01 b0:0e:01 \
                  b0:0e:7f b0:0e:7f b0:0e:7f b0:0e:7f b0:0e:7f

# 3. JOG FLICK — the same distance as ONE accelerated CC. Under the grid this
#    is the path that collapses to +-1 (schwung-page.ts changePage), so it is
#    also the swallow test: five pages of intent, and we count what moved.
sample jogflick inject b0:0e:05 b0:0e:7b

# 4. KNOB TURN, held — a touch first, because a turn with no hand on the knob
#    takes a different router branch and skips the held-param readout.
#    Equal and opposite, so the patch is left where it was found.
sample knob inject 90:00:7f b0:47:20 b0:47:60 80:00:00

# 5. KNOB FLICK — one CC carrying 63, the largest magnitude the shadow UI can
#    encode. Under the grid this becomes 63 separate ctl.onKnobTurn calls.
sample knobflick inject 90:00:7f b0:47:3f b0:47:7f 80:00:00

echo
echo "=== $ARM ==="
cat "$OUT"
echo
echo "worst period_ms per section:"
awk '/^--- /{s=$0} /period_ms=/{ match($0,/period_ms=[0-9.]+/); v=substr($0,RSTART+10,RLENGTH-10)+0;
     if (v>m[s]) m[s]=v } END{ for (k in m) printf "  %-28s %s\n", k, m[k] }' "$OUT" | sort
