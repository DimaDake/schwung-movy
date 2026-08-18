#!/usr/bin/env bash
# measure-pending-window.sh — how long schwung runs on a synthetic
# `__pending-*` Set identity before Move materialises the real one.
#
# Movy's set lifecycle is built to need no answer to this: identity is never
# waited on, and no timeout appears anywhere in it. So this is evidence, not a
# dependency — if a firmware change makes the window minutes long, nothing
# breaks, and this is how we would see it.
#
# Reads schwung's own SET_CHANGED lines, so it needs the unified log:
#   ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'
set -euo pipefail
HOST="${1:-move.local}"

ssh "ableton@$HOST" 'grep -E "SET_CHANGED: /data" /data/UserData/schwung/debug.log 2>/dev/null || true' \
  | sed -E 's/.*([0-9]{2}:[0-9]{2}:[0-9]{2})\.[0-9]+.*set_state\/([^ ]+) -> .*set_state\/(.*)$/\1 \2 \3/' \
  | awk '
      function secs(t,   a) { split(t, a, ":"); return a[1]*3600 + a[2]*60 + a[3] }
      # Entering a pending namespace from a real set starts the clock. Entering
      # one pending namespace from another does NOT restart it: the device log
      # shows the id changing several times while still unresolved, and the
      # window the user experiences spans all of them.
      $3 ~ /^__pending/ && $2 !~ /^__pending/ { t0 = $1; next }
      $3 !~ /^__pending/ && t0 != "" {
          printf "pending window: %s -> %s = %d s\n", t0, $1, secs($1) - secs(t0)
          n++; total += secs($1) - secs(t0); t0 = ""
      }
      END {
          if (n) printf "\n%d window(s), mean %.1f s\n", n, total / n
          else   print "no completed pending windows in the log (cleared, or none happened)"
      }'
