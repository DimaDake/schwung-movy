#!/usr/bin/env bash
# spike-movy-lab.sh — WP0 standalone feasibility run, no hands needed.
#
# Builds movy-lab from the pinned schwung tag, installs it as a standalone tool,
# then does two launches through schwung's own launch-standalone.sh. Both are
# started as root, because a launcher below the stack's uid cannot stop the
# stack (after restart-stack.py the stack is root's); run A's wrapper then
# drops to ableton:
#   A  as ableton (the uid of a normally booted stack, so of a Tools launch),
#      natural exit after $SECS_A seconds: frame/render stats, RT verdict;
#   B  as root (what a schwung-heal helper would give), SIGTERM'd after
#      $TERM_AFTER seconds: RT-as-root numbers and the SIGTERM path.
# Each launch's timeline (launch → SPI open → exit → Move back) is measured on
# the device clock. Logs land in spike/movy-lab/out/. Deleted in WP6.
#
# Why not open_tool_cmd: its handler calls startInteractiveTool directly and
# never consults tool_launch.mjs, so a standalone tool cannot be opened that
# way (finding, spike-findings.md). launch-standalone.sh is exactly what the
# Tools menu runs via host_system_cmd.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAB="$DIR/spike/movy-lab"
HOST="${HOST:-move.local}"
SECS_A="${SECS_A:-60}"
SECS_B="${SECS_B:-30}"
TERM_AFTER="${TERM_AFTER:-12}"
REMOTE=/data/UserData/schwung/modules/tools/movy-lab
OUT="$LAB/out"
SSH=(ssh -o ConnectTimeout=5 -o LogLevel=ERROR)
mkdir -p "$OUT"

"$LAB/build.sh"
"${SSH[@]}" "ableton@$HOST" "mkdir -p $REMOTE"
scp -q -o LogLevel=ERROR "$LAB/module.json" "$LAB/standalone" "$LAB/build/movy-lab" "ableton@$HOST:$REMOTE/"

# One launch, watched end to end inside a single ssh session. $1 user the lab
# runs as, $2 secs, $3 seconds before a SIGTERM (0 = let it exit by itself).
run() {
    local user="$1" secs="$2" term="$3" tag="$4"
    "${SSH[@]}" "root@$HOST" "sh -s" > "$OUT/$tag-timeline.txt" 2>&1 <<EOF
set -u
LOG=/data/UserData/schwung/movy-lab.log
DBG=/data/UserData/schwung/debug.log
now() { python3 -c 'import time;print("%.3f"%time.time())'; }
# By /proc/<pid>/comm: a bare name lookup would also see a dying stack, so
# "back" below is a pid CHANGE, as scripts/lib/restart-stack.py does it.
pid_of() { for d in /proc/[0-9]*; do [ "\$(cat \$d/comm 2>/dev/null)" = "\$1" ] && echo \${d#/proc/}; done; }
OLD_MOVE=\$(pid_of MoveOriginal); OLD_UI=\$(pid_of shadow_ui)
echo $secs > $REMOTE/secs
if [ "$user" = root ]; then rm -f $REMOTE/as_user; else echo $user > $REMOTE/as_user; fi
rm -f \$LOG
DBG0=\$(wc -c < \$DBG 2>/dev/null || echo 0)
echo "launch \$(now) as=$user stack_uid=\$(awk '/^Uid/{print \$2}' /proc/\$OLD_MOVE/status)"
sh /data/UserData/schwung/launch-standalone.sh $REMOTE/standalone
gone=""; back=""; termed=""; t0=\$(date +%s)
while [ \$((\$(date +%s) - t0)) -lt \$(( $secs + 90 )) ]; do
    if [ -z "\$gone" ] && [ "\$(pid_of MoveOriginal)" != "\$OLD_MOVE" ]; then gone=1; echo "move_gone \$(now)"; fi
    if [ "$term" != 0 ] && [ -z "\$termed" ] && grep -q "spi: open" \$LOG 2>/dev/null \
       && [ \$((\$(date +%s) - t0)) -ge $term ]; then
        termed=1; echo "sigterm \$(now)"; kill -TERM \$(pidof movy-lab) 2>/dev/null
    fi
    ui=\$(pid_of shadow_ui)
    if grep -q "movy-lab exit" \$LOG 2>/dev/null && [ -n "\$ui" ] && [ "\$ui" != "\$OLD_UI" ]; then
        back=1; echo "shadow_ui_back \$(now) pids=\$(pid_of MoveOriginal)/\$ui"; break
    fi
    sleep 0.2
done
[ -n "\$back" ] || echo "MOVE_NOT_BACK \$(now)"
echo "--- lab log"; cat \$LOG
echo "--- debug.log (standalone lines)"
tail -c +\$((DBG0 + 1)) \$DBG 2>/dev/null | grep -i "standalone" | tail -n 40
EOF
    echo "== $tag"; grep -E "^(launch|move_gone|sigterm|shadow_ui_back|MOVE_NOT_BACK)|start|spi: open|realtime|stat |sigterm:|exit 0|chpeak|js:|engine:|display-live|FAILED" "$OUT/$tag-timeline.txt" | head -60
}

run ableton "$SECS_A" 0 A
# Give Move time to settle before handing the device away again.
sleep 20
run root "$SECS_B" "$TERM_AFTER" B

ok=1
for t in A B; do
    grep -q "^shadow_ui_back" "$OUT/$t-timeline.txt" || { echo "RUN $t: MOVE DID NOT COME BACK"; ok=0; }
    grep -q "movy-lab exit 0" "$OUT/$t-timeline.txt" || { echo "RUN $t: lab did not exit cleanly"; ok=0; }
done
[ $ok = 1 ] && echo "SPIKE RUN: OK (logs in $OUT)" || { echo "SPIKE RUN: FAILED"; exit 1; }
