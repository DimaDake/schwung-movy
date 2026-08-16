#!/usr/bin/env bash
# bench-all-tracks.sh — per-track CPU cost for BOTH kinds of movy track.
#
# Tracks 1-4 are schwung's own chain slots, rendered by the shim. Tracks 5-16 are
# chains movy hosts itself. Both draw on the same per-frame work budget, so a
# usable answer to "how many tracks can I run" has to price both.
#
# The two are measured separately because they are reached differently:
#
#   HOST slots need movy CLOSED. While movy is in overtake it owns the UI MIDI
#   ring, so an injected note goes to movy rather than routing by channel to
#   slot N. With movy closed the normal routing applies.
#
#   MOVY chains need movy OPEN, and are driven through the engine's ch<N>:midi
#   param.
#
# Both phases use the same metric — work = `pre` + `post` from the shim's
# Frame(us) line — so the numbers are directly comparable. See
# docs/chain-cpu-benchmarks.md for why `total` is NOT usable (the ioctl wait
# absorbs added work, so it reads flat).
#
# Usage: ./scripts/bench-all-tracks.sh [move.local] [module ...]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"; shift || true
MODULES=("$@")
[ ${#MODULES[@]} -eq 0 ] && MODULES=(dexed plaits forge weird-dreams noisemaker obxd surge helm \
                                     osirus minijv mrdrums hera freak nusaw moog)

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
LOG=/data/UserData/schwung/debug.log
SETTLE=11

# Notes to play, per module kind.
#
# A C-major chord is meaningless on a drum-style module: those map each note to a
# specific pad, so 60/64/67/71 may land on nothing at all and "4 notes" would
# measure silence. Drum modules get four distinct PADS from their own note base
# instead (mrdrums 16 pads from 36, weird-dreams 8 from 36; forge is note-driven
# per voice).
MELODIC_PITCHES=(60 64 67 71)
DRUM_PITCHES=(36 37 38 39)
is_drum_module() {
    case "$1" in mrdrums|weird-dreams|forge|krautdrums|essaim|signal) return 0;; *) return 1;; esac
}
# Sets the global P[] — macOS ships bash 3.2, which has no `mapfile`, and a
# command-substitution round trip would break on `set -u` with an empty array.
set_pitches_for() {
    if is_drum_module "$1"; then P=("${DRUM_PITCHES[@]}"); else P=("${MELODIC_PITCHES[@]}"); fi
}

# Force polyphony where the module exposes it, so "4 notes" really means four
# voices. Without this a synth left in mono replaces its voice on each note and
# reads as flat across polyphony — which looks like an efficient synth and is
# actually a measurement artefact. Numeric params are written high and left to
# the module's own clamp; each module's control was found by dumping its live
# chain_params.
poly_setup() {  # poly_setup <set-fn> <module>
    local set_fn="$1" mod="$2"
    case "$mod" in
        helm)         $set_fn "polyphony" "16" ;;
        freak)        $set_fn "polyphony" "16" ;;
        obxd)         $set_fn "voice_count" "16" ;;
        mrdrums)      $set_fn "g_polyphony" "4" ;;
        weird-dreams) $set_fn "all_mono" "off" ;;
        *)            : ;;   # no polyphony control found in chain_params
    esac
}
SLOTS=4                      # host slots, and movy chains, used per measurement
BLD=$'\033[1m'; RST=$'\033[0m'; YEL=$'\033[1;33m'
RESULTS=/tmp/bench-all-results.tsv

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'
: > "$RESULTS"

ep() { node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1; }

work_avg() {
    ssh "ableton@$HOST" "grep -o 'Frame(us):.*' $LOG | tail -n 3" \
        | awk '{ pre=0; post=0;
                 for (i=1;i<=NF;i++) {
                     if ($i=="pre")  { split($(i+1),a,"="); pre=a[2]+0 }
                     if ($i=="post") { split($(i+1),b,"="); post=b[2]+0 }
                 }
                 s += pre+post; n++ }
             END { print (n? int(s/n):0) }'
}

open_movy() {
    ssh "ableton@$HOST" 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' >/dev/null 2>&1
    sleep 7
}
close_movy() {
    # Restart the stack rather than driving Back+confirm. The gesture route is
    # unreliable (it depends on which view movy is in) and a movy that is still
    # open SWALLOWS the injected notes — the host slots then sit silent and
    # measure ~0 us per track, which is not credible for a synth that costs
    # 700 us on a movy chain. Verified: with movy properly closed, helm on slot 0
    # reads 694 us; with movy open it reads 2 us.
    ssh "ableton@$HOST" 'systemctl --user restart move-launcher' >/dev/null 2>&1
    sleep 20
}

# Raw MIDI with an explicit channel, for host slots. schwung-midi-inject-ui.py
# builds the status byte itself, so this writes the ring directly instead.
host_note() {  # host_note <channel> <pitch> <on|off>
    local ch="$1" pitch="$2" st head
    if [ "$3" = on ]; then st=$((0x90 + ch)); head=9; else st=$((0x80 + ch)); head=8; fi
    ssh "ableton@$HOST" "python3 -c \"
import mmap
f=open('/dev/shm/schwung-ui-midi','r+b'); mm=mmap.mmap(f.fileno(),256)
for s in range(0,256,4):
    if mm[s]==0:
        mm[s+1]=$st; mm[s+2]=$pitch; mm[s+3]=100; mm[s]=$head
        break
mm.close(); f.close()
f=open('/dev/shm/schwung-control','r+b'); mm=mmap.mmap(f.fileno(),72); mm[3]=(mm[3]+1)%256; mm.close()
\"" >/dev/null 2>&1
}

echo "${BLD}=== per-track cost: host slots and movy chains ===${RST}"
echo "modules: ${MODULES[*]}"

# ── Phase A: host slots (movy closed) ───────────────────────────────────────
echo
echo "${BLD}--- phase A: schwung host slots (tracks 1-4), movy closed ---${RST}"
close_movy
for s in 0 1 2 3; do node scripts/module-slot.mjs set "$s" synth none >/dev/null 2>&1; done
sleep 4
ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
BASE_HOST=$(work_avg)
echo "baseline (movy closed, no host synths): ${BASE_HOST}us"
echo -e "baseline\thost\t0\t$BASE_HOST" >> "$RESULTS"

for MOD in "${MODULES[@]}"; do
    for s in 0 1 2 3; do node scripts/module-slot.mjs set "$s" synth "$MOD" >/dev/null 2>&1; done
    sleep 5
    set_pitches_for "$MOD"
    hset() { node scripts/module-slot.mjs set 0 "synth:$1" "$2" >/dev/null 2>&1; }
    poly_setup hset "$MOD"; sleep 1
    for N in 1 2 3 4; do
        for ch in 0 1 2 3; do
            for i in $(seq 0 $((N-1))); do host_note "$ch" "${P[$i]}" on; done
        done
        ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
        W=$(work_avg)
        for ch in 0 1 2 3; do
            for i in $(seq 0 $((N-1))); do host_note "$ch" "${P[$i]}" off; done
        done
        PER=$(( (W - BASE_HOST) / SLOTS )); [ "$PER" -lt 0 ] && PER=0
        printf '  %-14s host  %d note(s): work=%sus per-track=%sus\n' "$MOD" "$N" "$W" "$PER"
        printf '%s\thost\t%d\t%d\n' "$MOD" "$N" "$PER" >> "$RESULTS"
        sleep 1
    done
    for s in 0 1 2 3; do node scripts/module-slot.mjs set "$s" synth none >/dev/null 2>&1; done
    sleep 3
done

# ── Phase B: movy chains (movy open) ────────────────────────────────────────
echo
echo "${BLD}--- phase B: movy-hosted chains (tracks 5-16), movy open ---${RST}"
open_movy
for i in $(seq 0 11); do ep "ch$i:synth:module" ""; done
sleep 3
ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
BASE_MOVY=$(work_avg)
echo "baseline (movy open, no chains): ${BASE_MOVY}us"
echo -e "baseline\tmovy\t0\t$BASE_MOVY" >> "$RESULTS"

for MOD in "${MODULES[@]}"; do
    for c in $(seq 0 $((SLOTS-1))); do ep "ch$c:synth:module" "$MOD"; done
    sleep $((SLOTS + 4))
    set_pitches_for "$MOD"
    mset() { for c in $(seq 0 $((SLOTS-1))); do ep "ch$c:$1" "$2"; done; }
    poly_setup mset "$MOD"; sleep 1
    for N in 1 2 3 4; do
        for c in $(seq 0 $((SLOTS-1))); do
            for i in $(seq 0 $((N-1))); do ep "ch$c:midi" "144.${P[$i]}.100"; done
        done
        ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
        W=$(work_avg)
        for c in $(seq 0 $((SLOTS-1))); do
            for i in $(seq 0 $((N-1))); do ep "ch$c:midi" "128.${P[$i]}.0"; done
        done
        PER=$(( (W - BASE_MOVY) / SLOTS )); [ "$PER" -lt 0 ] && PER=0
        printf '  %-14s movy  %d note(s): work=%sus per-track=%sus\n' "$MOD" "$N" "$W" "$PER"
        printf '%s\tmovy\t%d\t%d\n' "$MOD" "$N" "$PER" >> "$RESULTS"
        sleep 1
    done
    for c in $(seq 0 $((SLOTS-1))); do ep "ch$c:synth:module" ""; done
    sleep 2
done

echo
echo "${BLD}results in $RESULTS${RST}"
