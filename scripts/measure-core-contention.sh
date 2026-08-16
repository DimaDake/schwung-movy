#!/usr/bin/env bash
# measure-core-contention.sh — how much does work on the OTHER cores cost the
# audio thread?
#
# The question this answers: MoveOriginal shows ~66% CPU in top, but most of
# that is not in the audio frame — three Audio_Worker threads, Link and the UI
# sit on other cores. Do they cost movy anything at all?
#
# They do, because the four A72s share L2 and one memory controller. This ramps
# 0..3 aggressor cores (dd through 1 MiB buffers — a bandwidth hog, deliberately
# harsher than Move's own idle threads) and reports how far schwung's per-frame
# work inflates. The result bounds what going standalone could win back by
# removing Move's off-thread load, which is ~0.56 core.
#
# Runs with movy CLOSED and Move's transport stopped — the baseline is schwung's
# own pre/post, and a small absolute number makes the percentage easy to read.
# Nothing here loads modules, so it is safe to run on a live set.
#
# Usage: ./scripts/measure-core-contention.sh [move.local] [max-hogs]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
MAX="${2:-3}"
LOG=/data/UserData/schwung/debug.log
SETTLE=12
BLD=$'\033[1m'; RST=$'\033[0m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

# Averaged over the last few Frame lines; each covers a 5 s window.
field() {  # field <name>
    ssh "ableton@$HOST" "grep -ao 'Frame(us):.*' $LOG | tail -n 3" \
        | awk -v want="$1" '{ for (i=1;i<=NF;i++) if ($i==want) { split($(i+1),a,"="); s+=a[2]+0; n++ } }
                             END { print (n? int(s/n):0) }'
}

# `pkill -x dd`, never `pkill -f "dd if=/dev/zero"`: -f matches the ssh command
# line carrying that same pattern, so the pattern kills the shell running it and
# the hogs survive. That failure is silent, and it accumulates aggressors across
# rows — the first version of this ramp reported 2 cores where 3 were running.
kill_hogs() { ssh "ableton@$HOST" 'pkill -x dd 2>/dev/null; true'; }
trap kill_hogs EXIT INT TERM

# How MoveOriginal's own CPU splits across its threads. Only `Audio Main/SPI` is
# in the audio frame; everything else is the off-thread load whose cost the ramp
# below estimates. Sampled from /proc/<tid>/stat, because busybox top has no -H.
threads() {
    ssh "ableton@$HOST" 'sh -s' <<'EOS'
PID=$(pgrep -f MoveOriginal | head -n 1)
snap() {
  for t in /proc/$PID/task/*; do
    [ -r "$t/stat" ] || continue
    # comm can contain spaces ("Audio Main/SPI"), so cut through the last ')'
    # before counting fields — positional parsing of the raw line is wrong.
    awk -v tid="$(basename $t)" -v nm="$(cat $t/comm | tr ' ' '_')" \
      '{sub(/^.*\) /,""); print tid, nm, $12+$13}' "$t/stat"
  done
}
snap > /tmp/thr_a; sleep 5; snap > /tmp/thr_b
awk 'NR==FNR{a[$1]=$3;next}{d=$3-a[$1]; if(d>0){printf "  %-20s %6.1f%%\n", $2, d/5.0; if($2!="Audio_Main/SPI") off+=d/5.0}}
     END{printf "  %-20s %6.1f%% of one core\n", "OFF-THREAD TOTAL", off}' /tmp/thr_a /tmp/thr_b \
  | sort -k2 -rn
EOS
}

echo "${BLD}=== MoveOriginal, per thread ===${RST}"
threads
echo
echo "${BLD}=== core contention ramp ===${RST}"
echo "host=$HOST, 0..$MAX aggressor cores"
printf '\n%-8s %-10s %-8s %-8s %-10s %s\n' "hogs" "work(us)" "pre" "post" "total" "vs idle"

BASE=0
for n in $(seq 0 "$MAX"); do
    kill_hogs
    [ "$n" -gt 0 ] && ssh "ableton@$HOST" \
        "for i in \$(seq 1 $n); do dd if=/dev/zero of=/dev/null bs=1M >/dev/null 2>&1 & done"
    ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
    PRE=$(field pre); POST=$(field post); TOT=$(field total)
    WORK=$((PRE + POST))
    [ "$n" -eq 0 ] && BASE=$WORK
    REL=$(awk -v w="$WORK" -v b="$BASE" 'BEGIN { printf "%+.0f%%", b? (w-b)*100.0/b : 0 }')
    printf '%-8s %-10s %-8s %-8s %-10s %s\n' "$n" "$WORK" "$PRE" "$POST" "$TOT" "$REL"
done
kill_hogs

echo
echo "${YEL}Read the work column, not total: total is period-locked and shrinks as"
echo "work grows, because the ioctl wait absorbs the difference. Interpolate at"
echo "~0.5 cores for what MoveOriginal's own off-thread load costs.${RST}"
