#!/usr/bin/env bash
# glitch-report.sh — what made the audio late, from the box's logs.
#
# movy-host logs one `audio: glitch frame` line for every frame whose work ran
# past its budget, and one `audio: late transfer` line for a late transfer no
# such frame explains (host/glitch.h). It keeps them, dated, for weeks in
# movy-glitch.log (host/glitch_log.h) with the launches, set loads and page
# opens around them. This pulls that off the device in one ssh call and ranks
# the causes: the costliest stage of each frame (for the chain render, the
# module that cost the most in it), the page that was open, and the day.
#
# Usage: ./scripts/glitch-report.sh [host] [-l] [-v]
#   -l   only since movy-host last started (default: everything kept)
#   -v   also print every glitch line
set -euo pipefail
HOST=move.local LAST=0 VERBOSE=0
for a in "$@"; do case "$a" in -l) LAST=1 ;; -v) VERBOSE=1 ;; *) HOST="$a" ;; esac; done

# A movy-glitch.log line is "YYYY-MM-DD HH:MM:SS.mmm text"; debug.log's (the
# fallback, for a build older than the file) is "HH:MM:SS.mmm [INFO ] [src] text".
REPORT=$(cat <<'AWK'
function stamp() { return $1 ~ /^[0-9][0-9][0-9][0-9]-/ ? $1 " " $2 : $1 }
/page ready ck=/ { match($0, /ck=[^ ]+/); page = substr($0, RSTART + 3, RLENGTH - 3); next }
/seq: loaded set / { page = "(set load)"; next }
/=== movy-host [0-9]/ { launches++; page = "(launch)"; next }
/audio: late transfer/ { late++; next }
/audio: glitch frame/ {
    n++
    if (verbose) print
    match($0, /work [0-9]+/); w = substr($0, RSTART + 5, RLENGTH - 5) + 0
    if (w > worst) { worst = w; worst_line = $0 }
    # The largest stage, host's own (io, params, post) or the engine's.
    cause = "?"; best = -1
    if (match($0, /io [0-9]+/)) { v = substr($0, RSTART + 3, RLENGTH - 3) + 0; if (v > best) { best = v; cause = "host io (display/input)" } }
    if (match($0, /post [0-9]+/)) { v = substr($0, RSTART + 5, RLENGTH - 5) + 0; if (v > best) { best = v; cause = "host post-render (status/mirror/output)" } }
    if (match($0, /params [0-9]+/)) {
        v = substr($0, RSTART + 7, RLENGTH - 7) + 0
        if (v > best) {
            best = v; cause = "host params"
            if (match($0, /slowest [^ ]+/)) cause = cause ": " substr($0, RSTART + 8, RLENGTH - 8)
        }
    }
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
    p = page == "" ? "?" : page; bypage[p]++
    if ($1 ~ /^[0-9][0-9][0-9][0-9]-/) byday[$1]++
    if (!first) first = stamp()
    last = stamp()
    next
}
END {
    if (!n && !late) { print "no glitches logged"; exit }
    printf "%d over-budget frames (%s .. %s), %d late transfers with no over-budget work, %d launches\n\n", n, first, last, late, launches
    printf "%6s  %8s  %s\n", "frames", "worst us", "costliest stage"
    for (c in count) printf "%6d  %8d  %s\n", count[c], peak[c], c | "sort -rn"
    close("sort -rn")
    printf "\n%6s  %s\n", "frames", "page open (last page ready / set load / launch before it)"
    for (p in bypage) printf "%6d  %s\n", bypage[p], p | "sort -rn"
    close("sort -rn")
    if (length(byday)) {
        printf "\n%6s  %s\n", "frames", "day"
        for (d in byday) printf "%6d  %s\n", byday[d], d | "sort -k2"
        close("sort -k2")
    }
    if (n) printf "\nworst frame:\n%s\n", worst_line
}
AWK
)

REMOTE=$(cat <<'SH'
D=/data/UserData/schwung G=$D/movy-glitch.log L=$D/debug.log
if [ -f "$G" ]; then
    if [ "$LAST" = 1 ]; then
        start=$(grep -n '=== movy-host [0-9]' "$G" | tail -1 | cut -d: -f1)
        tail -n +"${start:-1}" "$G"
    else cat "$G.1" "$G" 2>/dev/null; fi
else
    # Before movy-glitch.log existed: the flag-gated debug.log, undated.
    grep -E 'audio: (glitch frame|late transfer)|page ready ck=|seq: loaded set |=== movy-host ' "$L" 2>/dev/null || true
fi
SH
)

ssh -o ConnectTimeout=5 -o BatchMode=yes "ableton@$HOST" "LAST=$LAST bash -s" <<<"$REMOTE" | awk -v verbose="$VERBOSE" "$REPORT"
