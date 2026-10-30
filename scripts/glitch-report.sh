#!/usr/bin/env bash
# glitch-report.sh — what made the audio late, from the box's logs.
#
# movy-host logs one `audio: glitch frame` line for every frame whose work ran
# past its budget, and one `audio: late transfer` line for a late transfer no
# such frame explains (host/glitch.h). This pulls them off the device in one ssh
# call and ranks the causes: the costliest stage of each frame, and when that is
# the chain render, the module that cost the most in it.
#
# Usage: ./scripts/glitch-report.sh [host] [-a]
#   -a   every line in debug.log (default: since movy-host last started)
set -euo pipefail
HOST=move.local ALL=0
for a in "$@"; do case "$a" in -a) ALL=1 ;; *) HOST="$a" ;; esac; done

# debug.log spans every launch but only while the flag is on; movy-host.log is
# always written and is replaced at each launch.
# The costliest stage of each frame; for the chain render, its costliest module.
REPORT=$(cat <<'AWK'
/audio: late transfer/ { late++; next }
/audio: glitch frame/ {
    n++
    match($0, /work [0-9]+/); w = substr($0, RSTART + 5, RLENGTH - 5) + 0
    if (w > worst) { worst = w; worst_line = $0 }
    # The largest stage, host's own (io, params) or the engine's.
    cause = "?"; best = -1
    if (match($0, /io [0-9]+/)) { v = substr($0, RSTART + 3, RLENGTH - 3) + 0; if (v > best) { best = v; cause = "host io (display/input)" } }
    if (match($0, /post [0-9]+/)) { v = substr($0, RSTART + 5, RLENGTH - 5) + 0; if (v > best) { best = v; cause = "host post-render (status/mirror/output)" } }
    if (match($0, /params [0-9]+/)) { v = substr($0, RSTART + 7, RLENGTH - 7) + 0; if (v > best) { best = v; cause = "host params" } }
    e = index($0, "| engine ")
    if (e) {
        k = split(substr($0, e + 9), f, " ")
        for (i = 1; i <= k; i++) if (split(f[i], kv, "=") == 2 && kv[1] != "top") {
            v = kv[2] + 0; if (v > best) { best = v; cause = "engine " kv[1] }
        }
        if (cause == "engine render" && match($0, /top=[^ ]+/)) {
            split(substr($0, RSTART + 4, RLENGTH - 4), t, ",")
            split(t[1], m, ":"); cause = "engine render: " m[2] " (slot " m[1] ")"
        }
    } else if (match($0, /render [0-9]+/)) {
        v = substr($0, RSTART + 7, RLENGTH - 7) + 0; if (v > best) { best = v; cause = "engine (no breakdown)" }
    }
    count[cause]++
    if (best > peak[cause]) peak[cause] = best
    if (!first) first = $1
    last = $1
    next
}
END {
    if (!n && !late) { print "no glitches logged"; exit }
    printf "%d over-budget frames (%s .. %s), %d late transfers with no over-budget work\n\n", n, first, last, late
    printf "%6s  %8s  %s\n", "frames", "worst us", "costliest stage"
    for (c in count) printf "%6d  %8d  %s\n", count[c], peak[c], c | "sort -rn"
    close("sort -rn")
    if (n) printf "\nworst frame:\n%s\n", worst_line
}
AWK
)

REMOTE=$(cat <<'SH'
L=/data/UserData/schwung/debug.log H=/data/UserData/schwung/movy-host.log
pat='audio: (glitch frame|late transfer)'
if [ "$ALL" = 1 ]; then grep -E "$pat" "$L" 2>/dev/null || true
# The last launch's lines: debug.log after its last start line, else movy-host.log.
elif [ -f "$L" ] && grep -q 'audio: tid' "$L"; then
    start=$(grep -n 'audio: tid' "$L" | tail -1 | cut -d: -f1)
    tail -n +"$start" "$L" | grep -E "$pat" || true
else grep -E "$pat" "$H" 2>/dev/null || true
fi
SH
)

ssh -o ConnectTimeout=5 -o BatchMode=yes "ableton@$HOST" "ALL=$ALL bash -s" <<<"$REMOTE" | awk "$REPORT"
