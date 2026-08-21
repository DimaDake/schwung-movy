#!/usr/bin/env bash
# dev-probe.sh — single-round-trip device probe for interactive debugging.
#
# The clear-log / act / grep-log cycle that a debugging session runs by hand
# is normally 2-3 separate `ssh` calls (clear, act, grep). Each one is a full
# model turn, so the cost is round-trips, not the work itself. This does the
# whole cycle inside ONE ssh session: everything below is assembled locally
# into a single script and piped to one `ssh ... bash -s`, including the
# optional MIDI injection (itself a python heredoc nested inside the outer
# one — ordinary shell, since bash -s just keeps reading its own stdin).
#
# Usage:
#   ./scripts/dev-probe.sh log [host] [-p PATTERN] [-t TIMEOUT] [-i EVENT]... [-n]
#   ./scripts/dev-probe.sh status [host]
#
# log mode:
#   -p PATTERN   grep -E pattern to dump from debug.log (default: \[movy\])
#   -t TIMEOUT   max seconds to poll for PATTERN before dumping, in 0.5s steps
#                (default: 5). Polling beats a fixed sleep — see test.sh 6b.
#   -i EVENT     inject one MIDI event before waiting, as head:status:d1:d2[:nap]
#                (same grammar as ts_send in lib/test-set.sh, e.g. a knob-1 CC
#                bump is 0x0B:0xB0:71:65). Repeatable; events fire in order.
#   -n           don't touch/clear the log first (default: enable + clear it,
#                like every test-*.sh does before it acts)
#
# status mode:
#   reachability, deployed ui.js md5 (diffed against the local build if
#   present), and whether the unified log is enabled (debug_log_on) — the
#   three things "is my last deploy actually live" needs, in one call.
set -euo pipefail

MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="/data/UserData/schwung/modules/tools/movy"
LOG=/data/UserData/schwung/debug.log

usage() {
    sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
}

MODE="${1:-}"
[[ -z "$MODE" ]] && usage
shift

HOST="move.local"
if [[ "${1:-}" != -* && -n "${1:-}" ]]; then
    HOST="$1"; shift
fi

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'

# Shell-quote a value for safe embedding in the remote script text we build
# locally — PATTERN in particular can contain regex metacharacters or spaces.
q() { printf '%q' "$1"; }

# The device is Linux (md5sum); a dev machine may be macOS (md5 -q only).
local_md5() {
    if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | awk '{print $1}'
    else md5 -q "$1"; fi
}

run_remote() {
    # One ssh call for the whole probe. If it fails (host down, refused),
    # report once and exit — never assume unreachable means "no match".
    if ! printf '%s\n' "$1" | ssh -o ConnectTimeout=5 "ableton@$HOST" bash -s; then
        echo -e "${RED}Cannot reach $HOST (or remote script failed)${RST}" >&2
        exit 1
    fi
}

case "$MODE" in
status)
    SCRIPT="
echo REACHABLE
md5sum $REMOTE_DIR/ui.js 2>/dev/null || echo 'ui.js: NOT FOUND on device'
if [ -f /data/UserData/schwung/debug_log_on ]; then echo LOG_ENABLED=1; else echo LOG_ENABLED=0; fi
"
    OUT=$(printf '%s\n' "$SCRIPT" | ssh -o ConnectTimeout=5 "ableton@$HOST" bash -s) || {
        echo -e "${RED}Cannot reach $HOST${RST}" >&2; exit 1; }

    echo -e "${GRN}✓${RST} $HOST reachable"

    REMOTE_MD5=$(echo "$OUT" | awk '/ui\.js$/{print $1}')
    if [[ -n "$REMOTE_MD5" ]]; then
        if [[ -f "$MOVY_DIR/ui.js" ]]; then
            LOCAL_MD5=$(local_md5 "$MOVY_DIR/ui.js")
            if [[ "$LOCAL_MD5" == "$REMOTE_MD5" ]]; then
                echo -e "${GRN}✓${RST} ui.js matches local build ($REMOTE_MD5)"
            else
                echo -e "${YLW}→${RST} ui.js STALE — device has $REMOTE_MD5, local build is $LOCAL_MD5"
            fi
        else
            echo -e "${YLW}→${RST} deployed ui.js md5: $REMOTE_MD5 (no local ui.js built to diff against)"
        fi
    else
        echo -e "${RED}✗${RST} ui.js not found on device at $REMOTE_DIR"
    fi

    # Native substring match rather than a pipeline into a quiet-mode search:
    # under pipefail that combination kills the writer with EPIPE and reports a
    # *found* line as a failed check (browser-test/device-scripts.mjs Test 1
    # demonstrates it). The shared fixture lib has a wrapper for this, but it
    # is test infrastructure and this is an interactive tool — needing no
    # pipeline at all beats sourcing that lib for one substring test.
    if [[ "$OUT" == *"LOG_ENABLED=1"* ]]; then
        echo -e "${GRN}✓${RST} unified log enabled (debug_log_on present)"
    else
        echo -e "${YLW}→${RST} unified log NOT enabled — dev-probe.sh log will enable it"
    fi
    ;;

log)
    PATTERN='\[movy\]'
    TIMEOUT=5
    CLEAR=1
    EVENTS=()
    while getopts ":p:t:i:n" opt; do
        case "$opt" in
            p) PATTERN="$OPTARG" ;;
            t) TIMEOUT="$OPTARG" ;;
            i) EVENTS+=("$OPTARG") ;;
            n) CLEAR=0 ;;
            *) usage ;;
        esac
    done

    INJECT_BLOCK=""
    if (( ${#EVENTS[@]} )); then
        INJECT_BLOCK="python3 - <<'PYEOF'
import mmap, time
def send(head, status, d1, d2):
    with open('/dev/shm/schwung-ui-midi', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 256)
        for slot in range(0, 256, 4):
            if mm[slot] == 0:
                mm[slot+1] = status; mm[slot+2] = d1; mm[slot+3] = d2
                mm[slot] = head
                break
        mm.close()
    with open('/dev/shm/schwung-control', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 72)
        mm[3] = (mm[3] + 1) % 256
        mm.close()"
        for ev in "${EVENTS[@]}"; do
            IFS=':' read -r head st d1 d2 nap <<< "$ev"
            INJECT_BLOCK="$INJECT_BLOCK
send($head, $st, $d1, $d2)
time.sleep(${nap:-0.05})"
        done
        INJECT_BLOCK="$INJECT_BLOCK
PYEOF"
    fi

    CLEAR_BLOCK=""
    (( CLEAR )) && CLEAR_BLOCK="> $(q "$LOG")"

    # Poll in-place (remote side, still the one ssh call) instead of a fixed
    # sleep — tick rate varies 60-200Hz with device load (see test.sh 6b), so a
    # fixed wait either wastes time or misses a line that lands a beat late.
    STEPS=$(( TIMEOUT * 2 ))
    (( STEPS < 1 )) && STEPS=1

    SCRIPT="
set +e
touch /data/UserData/schwung/debug_log_on
$CLEAR_BLOCK
$INJECT_BLOCK
for i in \$(seq 1 $STEPS); do
    grep -q $(q "$PATTERN") $(q "$LOG") 2>/dev/null && break
    sleep 0.5
done
grep -E $(q "$PATTERN") $(q "$LOG") 2>/dev/null
true
"
    run_remote "$SCRIPT"
    ;;

*)
    usage
    ;;
esac
