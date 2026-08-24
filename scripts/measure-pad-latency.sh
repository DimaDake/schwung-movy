#!/usr/bin/env bash
# measure-pad-latency.sh — what a live pad note costs the UI, host vs movy track.
#
# The number that matters is the per-tick count of BLOCKING engine writes
# (`msetb ch<N>:*` in movy's perf line): a host track's pad note is one
# non-blocking shm write, while a movy track's used to be a blocking engine
# param write, ~2 ms of parked UI loop per note and serialised across a chord.
#
# `ipc_ms` alone cannot answer this and once appeared to. The probe did not wrap
# host_module_set_param_blocking at all, so the pad writes were invisible; the
# 2.4 ms an idle movy track reads is its chain page's param refresh (`mget
# ch<N>:*`), which is there whether a pad is touched or not. Averaged over a
# 120-tick window a handful of pad notes barely moves ipc_ms either way. Compare
# the labelled write count, and read ipc_ms as context.
#
# SETTLING MATTERS MORE THAN IT LOOKS. A first attempt at this measured 3.68 ms
# for a host track against a known-good 0.30 ms, because it sampled while movy
# was still booting AND while a chain module was loading — a module load alone
# blocks the callback for ~1986 us. Everything here is deliberately measured on a
# settled device: no load, no boot, and a discard window before each sample.
#
# Usage: ./scripts/measure-pad-latency.sh [move.local]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
LOG=/data/UserData/schwung/debug.log
SETTLE=8          # seconds of quiet before sampling
BURSTS=6
BLD=$'\033[1m'; RST=$'\033[0m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'
ep() { node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1; }

# Averages over the perf lines in the log. Each line is one 120-tick window.
perf_avg() {   # perf_avg <field>   e.g. ipc_ms, tick_ms
    ssh "ableton@$HOST" "grep -o 'perf_ipc[^|]*' $LOG | tail -n 6" \
        | awk -v f="$1=" '{ for (i=1;i<=NF;i++) if (index($i,f)==1) { split($i,a,"="); s+=a[2]; n++ } }
               END { printf "%.2f\n", (n ? s/n : 0) }'
}

# Blocking engine writes to the chain namespace, per tick — the pad path itself.
pad_writes() {   # pad_writes <chain>
    # Divided by EVERY perf window in the log, not only the ones that contain a
    # write: a per-tick rate averaged over just the windows that happened to see
    # one reads high exactly when the answer is "almost never". (Each window is
    # logged twice, by shadow and by the shim; both counts double, the ratio
    # does not.)
    local windows
    windows=$(ssh "ableton@$HOST" "grep -c perf_ipc $LOG")
    ssh "ableton@$HOST" "grep -o 'msetb ch$1:\* n=[0-9.]* ms=[0-9.]*' $LOG" \
        | awk -v w="${windows:-0}" '{ split($3,a,"="); split($4,b,"="); n+=a[2]; m+=b[2] }
               END { printf "%.2f %.2f\n", (w ? n/w : 0), (w ? m/w : 0) }'
}

pad_burst() {
    ts_send "0x09:0x90:68:100:0.04" "0x09:0x90:70:100:0.04" "0x09:0x90:72:100:0.04" \
            "0x09:0x90:74:100:0.04" "0x08:0x80:68:0:0.02" "0x08:0x80:70:0:0.02" \
            "0x08:0x80:72:0:0.02" "0x08:0x80:74:0:0"
}
# Enter Session, tap the step, and STAY. Selecting a track from the row leaves
# Session on its own; tapping the button again re-enters it, where the pads are
# clip launchers and the screen is the master FX page. The first run of this
# script did exactly that and measured that same state twice — two identical
# rows that looked like a clean result.
select_track() {
    ts_tap_cc 50; sleep 0.8; ts_tap_note $((16 + $1)); sleep 1.2
}

# The measurement is worthless if it ran on the wrong track, and the numbers
# themselves cannot show it: switch.ts logs every switch so this can be checked.
verify_track() {   # verify_track <track-index> <host|movy>
    local got
    got=$(ssh "ableton@$HOST" "grep -o 'track: active=[0-9]* kind=[a-z]*' $LOG | tail -1")
    [ "$got" = "track: active=$1 kind=$2" ] && return 0
    printf '  %sselection failed: expected "track: active=%s kind=%s", log says "%s"%s\n' \
        "$YEL" "$1" "$2" "${got:-nothing}" "$RST"
    return 1
}

measure() {  # measure <label> <track-index> <host|movy> <chain|->
    ssh "ableton@$HOST" "> $LOG"
    select_track "$2"
    sleep 3                               # let the track switch settle
    verify_track "$2" "$3" || return 1
    ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
    local idle_ipc; idle_ipc=$(perf_avg ipc_ms)
    ssh "ableton@$HOST" "> $LOG"; sleep 1
    for _ in $(seq 1 $BURSTS); do pad_burst; done
    sleep "$SETTLE"
    local writes='n/a'
    [ "$4" != "-" ] && writes=$(pad_writes "$4" | awk '{ printf "%s/tick (%s ms/tick)", $1, $2 }')
    printf '  %-14s idle=%sms  playing=%sms  tick=%sms  pad writes: %s\n' \
        "$1" "$idle_ipc" "$(perf_avg ipc_ms)" "$(perf_avg tick_ms)" "$writes"
}

echo "${BLD}=== pad-note IPC cost, host vs movy ===${RST}"

# A chain must be loaded for the movy case to be meaningful — but load it FIRST
# and let it settle, because the load itself blocks the callback for ~2 ms and
# would land in the sample.
ep "ch4:synth:module" plaits
sleep 8
echo "  (plaits loaded on movy chain 4 — track index 4, settled)"
echo

measure "host track 1" 0 host -
measure "movy track 5" 4 movy 4

echo
echo "${YEL}Expected: no ch4 pad writes at all — the engine answers pads on the audio"
echo "thread. Reverting engineOwnsPads() to false puts them back at ~0.1/tick"
echo "(~2 ms per note), which is how this was proved to have teeth.${RST}"
ep "ch4:synth:module" ""
