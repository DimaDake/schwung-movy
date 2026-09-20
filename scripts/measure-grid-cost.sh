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
#   MODULE=minijv ./scripts/measure-grid-cost.sh off
#   MODULE=minijv ./scripts/measure-grid-cost.sh page
#
# MODULE is optional and names what must be loaded. Prefer minijv: it is the
# largest module in the fleet (433 params, 57 levels, 70 pages — SP-39 read the
# count back as `schwung-body ok track=0 ck=synth pages=70` and corrected the 72
# that stood here), it is where the lag was reported, and it is the only fixture
# with enough pages for the jog sections to stay on the component — see the
# preflight.
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

# SHIP THE INJECTOR THESE TOKENS ARE WRITTEN FOR, EVERY RUN. Nothing else
# deploys inject-any.py, so the device keeps whichever copy someone last put
# there by hand. Measured 2026-09-16: that copy read d1/d2 as DECIMAL and threw
# on `0e`, so every inject below failed — and a failed inject does not stop the
# run, it only removes the gesture, leaving five sections of real numbers that
# are all the idle floor. That is how the 2026-09-13 A/B baseline in
# docs/schwung-page-migration.md came to read "the arms do not separate". One
# scp against a three-minute measurement makes the instrument the repo's copy
# rather than the device's.
scp -q "$(dirname "$0")/inject-any.py" "ableton@$HOST:/data/UserData/inject-any.py" \
    || { echo "measure-grid-cost: could not ship inject-any.py — refusing to measure with an injector of unknown vintage" >&2; exit 2; }

# The flag's values are the Settings row's order (src/renderer/schwung-grid.ts):
# 0 = MOVY, 1 = BODY, 2 = PAGE. There is no build that selects any of them.
case "$ARM" in
    off)  SCHWUNGGRID=0 ;;
    page) SCHWUNGGRID=1 ;;
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
# The one pattern both the preflight and every sample read the body through. It
# was written out twice; the sample guard below is only as good as its agreeing
# with the preflight, so there is one copy.
BODY_RE='schwung-body (ok track=[0-9]+ ck=[a-z_0-9:]+ pages=[0-9]+|not-ready[^|]*|mode=[a-z]+|movy-page ck=[a-z_0-9:]+|no-model|step-page-selected)'
BODY_NOW=""

# SECTIONS NARROWS A RUN TO THE SECTIONS THAT ARE VALID ON THE MODULE IN FRONT
# OF IT. The jog sections move ten detents; on a component with fewer than ~12
# pages that walks off the end and every LATER section then measures an
# undelegated page. The warning above says so but does not stop the run, and a
# `knob` number taken after the walk-off is not a knob number — measured
# 2026-09-19 on plaits (2 pages): four of five sections came back INVALID and
# only `idle` survived. `SECTIONS="idle knob"` is how a small module gets an
# honest number: the sections named, in the script's order, nothing else.
WANT="${SECTIONS:-idle jog jogflick knob knobflick}"

sample() {
    local label="$1"; shift
    case " $WANT " in *" $label "*) ;; *) return 0 ;; esac
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
    # A SAMPLE THAT LEFT THE MEASURED BODY MEASURED SOMETHING ELSE, and the
    # `schwung-view` check above cannot see it: the VIEW stays VIEW_KNOBS while
    # the jog walks off the last page of `synth` onto `midi_fx1`, whose contract
    # is not ready — so the component is no longer delegated, nothing polls, and
    # the section comes back CHEAPER than idle. Measured 2026-09-16: the page
    # arm's jog/knob sections read 0.5 calls/tick against an idle of 3.0, which
    # reads as "the gesture is free" and is really "the page was gone".
    #
    # `schwung-body` logs once per distinct reason, so a section that strays and
    # STAYS strayed emits nothing of its own — which is why the last reason is
    # carried across sections in BODY_NOW rather than re-derived per sample.
    local seen stray
    seen=$(sshd "grep -oE '$BODY_RE' $LOG")
    [ -n "$seen" ] && BODY_NOW=$(printf '%s\n' "$seen" | tail -n 1)
    stray=$(printf '%s\n' "$seen" | grep -v -F -x "$WHERE" | grep -v '^$')
    if [ -n "$stray" ] || { [ -n "$BODY_NOW" ] && [ "$BODY_NOW" != "$WHERE" ]; }; then
        echo "  INVALID: the drawn body was not '$WHERE' throughout this sample (ends at: ${BODY_NOW:-unchanged})" >> "$OUT"
        [ -n "$stray" ] && printf '%s\n' "$stray" | sed 's/^/    /' >> "$OUT"
    fi
    sshd "grep perf_ipc $LOG" | sed -E 's/.*perf_ipc //' >> "$OUT"
    # `perf_ipc` says the tick is slow; `perf_phase` says WHICH PART of it is,
    # summed over the same window. Both are needed by anything that has to
    # attribute a per-tick cost rather than just report one, and they were
    # written in the same probe for that reason. One line each, so a sample
    # reads as `ipc` then `phases`.
    sshd "grep perf_phase $LOG" | sed -E 's/.*perf_phase //' >> "$OUT"
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
WHERE=$(sshd "grep -oE '$BODY_RE' $LOG | tail -n 1")
echo "== preflight: ${WHERE:-(no schwung-body line at all)}" | tee -a "$OUT"
case "$WHERE" in
    *"ok track="*) ;;                       # grid is drawing — the arm we want
    *mode=off*)    echo "   (flag-off arm: movy's own renderer, as intended)" | tee -a "$OUT" ;;
    *)  echo "ABORT: not on a module page with a module loaded — nothing to measure." >&2
        echo "       Park the device on the movy track's module page and re-run." >&2
        exit 2 ;;
esac

# WHICH MODULE, SAID OUT LOUD — and refused if it is not the one asked for.
#
# This script measures whatever happens to be loaded, and for a long while that
# was plaits: 14 params, one level, the SMALLEST shape in the fleet. Every
# number in docs/schwung-page-migration.md up to SP-26 was taken there, which is
# why SP-27's per-tick CPU could sit open with no attribution — the cost scales
# with the module, and the fixture was the best case. minijv is the other end
# (433 params, 57 levels) and is the module the complaint came from, so a run
# that means to measure it must not quietly measure something else.
#
# `MODULE=` is a substring of the module NAME as movy logs it; unset keeps the
# old behaviour of measuring whatever is there.
MODULE="${MODULE:-}"
LOADED=$(sshd "grep -oE 'schwung-body ok track=[0-9]+ ck=[a-z_0-9:]+ pages=[0-9]+' $LOG | tail -n 1")
echo "== module: ${LOADED:-(unknown — off arm draws no body line)}" | tee -a "$OUT"
if [ -n "$MODULE" ] && [ -n "$LOADED" ]; then
    NAME=$(sshd "grep -oiE '\"?$MODULE\"?' $LOG | head -n 1")
    if [ -z "$NAME" ]; then
        echo "ABORT: asked for MODULE=$MODULE and the log never names it." >&2
        echo "       Load $MODULE on the movy track and re-run, or unset MODULE." >&2
        exit 2
    fi
fi

# THE GESTURE SECTIONS NEED A MODULE THE JOG CANNOT WALK OFF, and until now
# nothing checked. Ten detents on a 2-page module walk off the end of `synth`
# onto `midi_fx1`, whose contract is not ready — so the component stops being
# delegated, nothing polls, and the sections come back CHEAPER than idle,
# reading as "the gesture is free". That invalidated four of the five sections
# of the 2026-09-16 and 2026-09-17 device runs, and it was found by reading the
# body reason afterwards rather than by being refused up front. minijv plans 70
# pages, so it clears this by a wide margin; the check is on the NUMBER, not on
# the module, because any big module will do.
#
# AND IT IS NOT ENOUGH ON minijv EITHER, measured 2026-09-19 (SP-39): on a
# 70-page component a 10-detent jog does not walk off the end of a small
# component, it walks the whole CHAIN — midi_fx1 -> fx1 -> fx2 -> lfo -> mix and
# back — so all four gesture sections come back INVALID and only `idle` and
# `knob` are usable. `SECTIONS="idle knob"` is the fix until the jog is bounded.
PAGES=$(printf '%s' "$WHERE" | sed -nE 's/.*pages=([0-9]+).*/\1/p')
if [ -n "$PAGES" ] && [ "$PAGES" -lt 12 ]; then
    echo "  WARNING: only $PAGES pages — the 10-detent jog sections below will walk off the" | tee -a "$OUT"
    echo "           end of this component and measure an undelegated page, not a gesture." | tee -a "$OUT"
    echo "           Load a module with more pages (minijv plans 70) for a valid gesture number." | tee -a "$OUT"
fi

# 1. IDLE — the floor. Anything the grid costs per frame with no input shows here.
#
# 8, not 12. `perf_ipc` reports every 120 ticks and the device ticks at 63-205 Hz,
# so this spans 4-13 reports — several, which is what the cadence note above asks
# for, with the shortest plausible tick rate still clearing it. The old 12 bought
# more of the same reading: the within-arm spread across a window was <=0.4 ms
# where the gap between arms was 4.3, so the extra seconds were not resolving
# anything. Four sections x two arms makes the difference worth having.
sample idle sleep 8

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
