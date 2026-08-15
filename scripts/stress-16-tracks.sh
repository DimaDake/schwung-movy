#!/usr/bin/env bash
# stress-16-tracks.sh — run every movy track at once and find where it breaks.
#
# The per-synth benchmark (docs/chain-cpu-benchmarks.md) measures four chains and
# extrapolates. This does the real thing: load the same synth into all twelve
# movy chains, hold a chord in every one, and walk the polyphony up until the
# frame stops keeping up. Extrapolation and reality are allowed to disagree, and
# if they do, reality wins.
#
# Reports, per note count:
#   work     `pre` + `post` per frame — the number that must stay under ~2000 us
#   total    the whole frame; it sits flat while the ioctl wait absorbs work and
#            climbs once that wait is gone, which is the actual failure
#   verdict  OK / OVER, against the measured ~2000 us work ceiling
#
# NOTE on presets: some synths default to a MONOPHONIC preset, which makes a
# chord look free. noisemaker needs preset 9. Set per module below.
#
# Usage: ./scripts/stress-16-tracks.sh [move.local] [module ...]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"; shift || true
MODULES=("$@")
[ ${#MODULES[@]} -eq 0 ] && MODULES=(dexed plaits noisemaker obxd)

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
LOG=/data/UserData/schwung/debug.log
CHAINS=12                  # every movy track
SETTLE=11
WORK_CEILING=2000          # measured; see docs/chain-cpu-benchmarks.md
MELODIC=(60 64 67 71)
DRUMS=(36 37 38 39)
BLD=$'\033[1m'; RST=$'\033[0m'; GRN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'
ep() { node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1; }

frame() {  # prints "work total"
    ssh "ableton@$HOST" "grep -o 'Frame(us):.*' $LOG | tail -n 3" \
        | awk '{ pre=0; post=0; tot=0;
                 for (i=1;i<=NF;i++) {
                     if ($i=="pre")   { split($(i+1),a,"="); pre=a[2]+0 }
                     if ($i=="post")  { split($(i+1),b,"="); post=b[2]+0 }
                     if ($i=="total") { split($(i+1),c,"="); tot=c[2]+0 }
                 }
                 w += pre+post; t += tot; n++ }
             END { if (n) printf "%d %d\n", w/n, t/n; else print "0 0" }'
}

set_pitches() {
    case "$1" in
        mrdrums|weird-dreams|forge|krautdrums) P=("${DRUMS[@]}") ;;
        *) P=("${MELODIC[@]}") ;;
    esac
}

# Presets and polyphony that make a chord actually cost four voices.
prepare() {  # prepare <module>
    case "$1" in
        # Preset 1 is monophonic; 9 is the polyphonic one.
        noisemaker) for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:preset" "9"; done ;;
        helm)       for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:polyphony" "16"; done ;;
        freak)      for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:polyphony" "16"; done ;;
        obxd)       for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:voice_count" "16"; done ;;
        mrdrums)    for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:g_polyphony" "4"; done ;;
        *) : ;;
    esac
}

echo "${BLD}=== 16-track stress: all $CHAINS movy chains at once ===${RST}"
echo "host=$HOST  work ceiling ${WORK_CEILING}us  modules: ${MODULES[*]}"

for i in $(seq 0 11); do ep "ch$i:synth:module" ""; done
sleep 3
ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
read -r BASE_W BASE_T <<<"$(frame)"
echo
echo "baseline (movy open, no chains): work=${BASE_W}us total=${BASE_T}us"

for MOD in "${MODULES[@]}"; do
    echo
    echo "${BLD}--- $MOD on all $CHAINS movy tracks ---${RST}"
    set_pitches "$MOD"
    for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" "$MOD"; done
    # One load per audio callback, so a twelve-chain load takes a moment.
    sleep $((CHAINS + 6))
    prepare "$MOD"
    sleep 2

    LOADED=$(ssh "ableton@$HOST" "grep -c 'chain [0-9]*: synth = $MOD' $LOG" 2>/dev/null || echo 0)
    printf '  %-10s %-10s %-10s %s\n' "notes" "work" "total" "verdict"
    for N in 1 2 3 4; do
        for c in $(seq 0 $((CHAINS-1))); do
            for i in $(seq 0 $((N-1))); do ep "ch$c:midi" "144.${P[$i]}.100"; done
        done
        ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
        read -r W T <<<"$(frame)"
        for c in $(seq 0 $((CHAINS-1))); do
            for i in $(seq 0 $((N-1))); do ep "ch$c:midi" "128.${P[$i]}.0"; done
        done
        if [ "$W" -le "$WORK_CEILING" ]; then V="${GRN}OK${RST}"; else V="${RED}OVER${RST}"; fi
        printf '  %-10s %-10s %-10s %b\n' "$N" "${W}us" "${T}us" "$V"
        sleep 1
    done
    echo "  (chains that reported a load: $LOADED)"
    for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" ""; done
    sleep 3
done

for i in $(seq 0 11); do ep "ch$i:synth:module" ""; done
echo
echo "${YEL}work must stay under ${WORK_CEILING}us; total climbing above ~2700us means"
echo "the ioctl wait is exhausted and the frame is genuinely late.${RST}"
