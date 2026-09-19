#!/bin/bash
# measure-pad-page-latency.sh — what the pad-press page switch costs, per arm.
#
# SP-39. On a drum track a pad press turns the page to that voice's page. Under
# `page` that switch is reported as noticeably slower than under `off`, where
# movy draws the page itself. This is the A/B for it.
#
# WHAT IS TIMED IS THE GESTURE, NOT THE FRAME RATE. A press is handled in
# `onMidiMessageInternal`, which the host runs BEFORE `tick`, so a synchronous
# cost at the press is inside NO phase — it lands in the gap `perf_ipc` reports
# as `period_ms` / `peak_period`. A cost paid over the following ticks (each
# arriving cell read one per tick) WOULD land in `ctlpoll` (Schwung's controller
# tick) or `knoblevels` (movy reading the eight cells back). Those two phases
# already exist and are the reason this is not just a period number: they are
# what tells a stall AT the press from a fill-in AFTER it.
#
# `padpage` (src/midi/router.ts) is the third: it wraps the two adjacent
# page-follow calls — movy's `selectBankForPad` and Schwung's `focusVoice` — so
# both arms measure the same code region and the arm is a FLAG, not a build.
#
# THE RACK. cw78, one of the four modules whose movy_config declares `pad` on its
# banks. That declaration is the only thing that gives a module VOICES under
# `page` (SP-14 translates it into a hierarchy with a `note` per bank, and
# `voicesOf` reads those), so it is the only shape where a pad press has a page
# to turn to. The fixture's mrdrums is a drum module that declares no note map,
# so `focusVoice` finds nothing and the gesture does not exist there — measured,
# `drumPad note=71 pad=4` with no `at=` change.
#
# LEFT-HALF PADS ONLY: `drumPadOfPhys` returns -1 for `col >= DRUM_COLS`, so a
# right-half pad addresses no voice. Note 71 is rack pad 4, note 68 is rack pad 1.
#
# Usage:
#   MODULE=cw78 TRACK=0 ./scripts/measure-pad-page-latency.sh off
#   MODULE=cw78 TRACK=0 ./scripts/measure-pad-page-latency.sh page
set -u
HOST="${HOST:-move.local}"
ARM="${1:-unknown}"
LOG=/data/UserData/schwung/debug.log
OUT="${OUT:-/tmp/pad-page-$ARM.txt}"
PREFS=/data/UserData/schwung/modules/tools/movy/prefs.json
MODULE="${MODULE:-cw78}"
TRACK="${TRACK:-0}"

sshd() { ssh "ableton@$HOST" "$@"; }

# The injector is shipped every run for the same reason measure-grid-cost.sh
# ships it: nothing else deploys it, and an injector of unknown vintage eats the
# gesture silently, leaving sections that are all the idle floor.
scp -q "$(dirname "$0")/inject-any.py" "ableton@$HOST:/data/UserData/inject-any.py" \
    || { echo "measure-pad-page-latency: could not ship inject-any.py — refusing to measure" >&2; exit 2; }

case "$ARM" in
    off)  SCHWUNGGRID=0 ;;
    page) SCHWUNGGRID=2 ;;
    *)    echo "usage: measure-pad-page-latency.sh off|page" >&2; exit 2 ;;
esac

sshd "test -f /data/UserData/schwung/debug_log_on || touch /data/UserData/schwung/debug_log_on"

# THE MODULE GOES ON BEFORE THE ARM IS ARMED, so the load — which blocks the
# audio callback for ~2 ms — is never inside a sample.
node "$(dirname "$0")/engine-param.mjs" set "ch$TRACK:synth:module" "$MODULE" "$HOST" >/dev/null 2>&1
sleep 6

# CLEAR THE LOG BEFORE THE REOPEN, never after: `mode=off` is a STABLE reason
# logged once per process, so a truncate after movy's first frame erases the
# only proof the off arm will ever emit (measure-grid-cost.sh records the same
# ordering for the same reason).
sshd "> $LOG"
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
sshd 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"'
sleep 9

BODY_RE='schwung-body (ok track=[0-9]+ ck=[a-z_0-9:]+ pages=[0-9]+|not-ready[^|]*|mode=[a-z]+|movy-page ck=[a-z_0-9:]+|no-model|step-page-selected)'

# THE TRACK BUTTON, so the pad routes to the track the module is on.
inject() {
    if ! sshd "python3 /data/UserData/inject-any.py $* >/dev/null 2>&1"; then
        echo "  INVALID: inject FAILED — this section measured nothing: $*" >> "$OUT"
        echo "measure-pad-page-latency: inject failed for: $*" >&2
    fi
}
inject "b0:$((40 + 3 - (TRACK % 4))):7f" "b0:$((40 + 3 - (TRACK % 4))):00"
sleep 2

# PREFLIGHT: the page must be ON, and the pad must actually turn it. A fixed
# pad is pressed and the body reason has to name the page it landed on — the
# same positive signal measure-grid-cost.sh takes from a jog, and the only way
# to tell "the page did not move" from "the press never arrived".
BEFORE=$(sshd "grep -oE '$BODY_RE' $LOG | tail -n 1")
# The page INDEX is the `at=` the body reason carries, and BODY_RE deliberately
# stops before it — `at=` changes on every press, so it cannot be part of the
# identity the sample guard compares against, but it IS the only evidence the
# press turned a page rather than landing on the one already shown.
BEFORE_AT=$(sshd "grep -oE 'at=[0-9]+' $LOG | tail -n 1")
inject "90:47:64" "80:47:00"
sleep 2
AFTER=$(sshd "grep -oE '$BODY_RE' $LOG | tail -n 1")
AFTER_AT=$(sshd "grep -oE 'at=[0-9]+' $LOG | tail -n 1")
echo "== preflight: ${BEFORE:-(no schwung-body line at all)} ${BEFORE_AT:-(at=?)}  ->  ${AFTER:-(none)} ${AFTER_AT:-(at=?)}" | tee -a "$OUT"
case "$AFTER" in
    *"ok track="*) ;;
    *mode=off*)    echo "   (flag-off arm: movy's own renderer, as intended)" | tee -a "$OUT" ;;
    *) echo "ABORT: not on a module page with a module loaded — nothing to measure." >&2; exit 2 ;;
esac
WHERE="$AFTER"

# THE GESTURE ITSELF MUST HAVE LANDED, on the arm where it exists. Under `off`
# the pad moves movy's own bank and there is no `at=` to read, so this is only
# asserted for the page arm — and it is asserted there rather than assumed,
# because a module with no voices makes every later number the idle floor.
if [ "$ARM" = "page" ]; then
    if ! sshd "grep -q 'drumPad note=71 pad=4' $LOG"; then
        echo "ABORT: the pad did not address a voice (no 'drumPad note=71 pad=4')." >&2
        echo "       $MODULE declares no rack on this path; see the header." >&2
        exit 2
    fi
    if [ -z "$BEFORE_AT" ] || [ "$BEFORE_AT" = "$AFTER_AT" ]; then
        echo "ABORT: the pad did not change the page (${BEFORE_AT:-at=?} -> ${AFTER_AT:-at=?})." >&2
        exit 2
    fi
fi

sample() {
    local label="$1"; shift
    sshd "> $LOG"
    "$@"
    sleep 2
    echo "--- $ARM / $label ---" >> "$OUT"
    local stray
    stray=$(sshd "grep -oE '$BODY_RE' $LOG | grep -v -F -x '$WHERE' | grep -v '^$'")
    if [ -n "$stray" ]; then
        echo "  INVALID: the drawn body left '$WHERE':" >> "$OUT"
        printf '%s\n' "$stray" | sed 's/^/    /' >> "$OUT"
    fi
    sshd "grep perf_ipc $LOG" | sed -E 's/.*perf_ipc //' >> "$OUT"
    sshd "grep perf_phase $LOG" | sed -E 's/.*perf_phase //' >> "$OUT"
}

# Twelve alternating presses, 200 ms apart — several per 120-tick window, so the
# `padpage` phase clears the six-phase print cutoff and `peak_period` has more
# than one press to catch.
PRESSES=''
for _ in 1 2 3 4 5 6; do
    PRESSES="$PRESSES 90:47:64 80:47:00 sleep:200 90:44:64 80:44:00 sleep:200"
done

echo "== module: $MODULE on track $TRACK, arm $ARM" | tee -a "$OUT"
sample idle sleep 8
sample press inject $PRESSES

echo
echo "=== $ARM ==="
cat "$OUT"
