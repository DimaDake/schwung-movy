#!/usr/bin/env bash
# measure-send-colocation.sh — does a send cost the block more than the same FX
# inserted on the track that feeds it?
#
# `2026-09-05-send-fx-and-mix-page-design.md` §3 says sends only win at N>=4
# tracks, and that at N=1 they are "strictly worse": a send moves work OUT of
# the parallel pool and ONTO the critical path, because a bus is a sum of tracks
# and cannot start until every chain has rendered. The proposal is to let a bus
# render on the SAME LANE as the tracks feeding it, which removes that penalty
# without delaying anything.
#
# **The proposal needs no new code to be measured.** Co-locating a bus with its
# only feeder produces exactly the work an INSERT on that track already
# produces: synth, then FX, in order, on one lane. So the insert arm IS the
# proposed optimisation, measured on shipped code, and
#
#     saving = wall(send) - wall(insert)
#
# is what co-location would recover. If that difference is not there, the
# proposal has nothing to win and should not be built.
#
# A TWELVE-CHAIN set on purpose, unlike measure-parallel-sends.sh. That script
# wants the send phase alone and uses one synth so the chain phase is noise;
# this one is asking whether the chain phase has SLACK to absorb a bus, which a
# one-synth set cannot answer — with nothing else to rebalance against, moving
# work into the pool saves nothing and the honest answer would be a false zero.
#
# THREE ARMS, A/B/A'. Loaded modules, held notes and settled tails all survive
# between arms, so a single send-then-insert pair cannot separate "the insert is
# cheaper" from "the second arm is always cheaper". The two send arms are the
# error bar.
#
# MULTI-FEEDER runs (`feeders` > 1) drop the insert arm, because an insert no
# longer models co-location: two feeders would need two copies of the FX, which
# is a different amount of work. What they answer instead is the question the
# single-feeder run cannot — whether the accept rule still FIRES when the group
# is several chains wide, and whether the wall drops when it does. A refusal
# there is the signal that the "all feeders on one lane" constraint is what
# binds, and that a precedence-aware scheduler is the next thing to build.
#
# Usage: ./scripts/measure-send-colocation.sh [move.local] [fx] [chains] [feeders]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
# The heaviest FX in the cost table (354 us, 12% of a frame). The proposal is
# about the heavy end: a 45 us chorus cannot save more than 45 us wherever it
# runs, so it could not falsify anything.
FX="${2:-tape-echo2}"
CHAINS="${3:-12}"
FEEDERS="${4:-1}"  # how many tracks send to bus 0
TRACK=0            # the fed track, and the one the insert goes on
SETTLE=6

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
source "$MOVY_DIR/scripts/lib/chain-bench.sh"
LOG=/data/UserData/schwung/debug.log
BLD=$'\033[1m'; RST=$'\033[0m'; GRN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

echo "${BLD}=== send vs insert: what co-locating a bus with its feeder would save ===${RST}"
echo "host=$HOST  fx=$FX  chains=$CHAINS  feeders=$FEEDERS (ch0..ch$((FEEDERS-1)))"

ts_open_movy
sleep 8
cb_require_engine_link
cb_discover_samples

SEND_BUSES=$(node -e "import('./dist/esm/chain/config.js').then(m => console.log(m.SEND_BUSES))")

# ── the busy set ────────────────────────────────────────────────────────────
ASSIGN=()
for c in $(seq 0 $((CHAINS-1))); do
    ASSIGN+=("${CB_DEFAULT_MODULES[$((c % ${#CB_DEFAULT_MODULES[@]}))]}")
done
echo
echo "loading ${CHAINS} chains: ${ASSIGN[*]}"
for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" "${ASSIGN[$c]}"; done
sleep $((CHAINS + 6))
for c in $(seq 0 $((CHAINS-1))); do cb_prepare "${ASSIGN[$c]}" "$c"; done
sleep 2

hold() {
    local c
    for c in $(seq 0 $((CHAINS-1))); do
        cb_pitches "${ASSIGN[$c]}"
        for i in 0 1 2 3; do ep "ch$c:midi" "144.${CB_P[$i]}.100"; done
    done
}
release() {
    local c
    for c in $(seq 0 $((CHAINS-1))); do
        cb_pitches "${ASSIGN[$c]}"
        for i in 0 1 2 3; do ep "ch$c:midi" "128.${CB_P[$i]}.0"; done
    done
}
# Re-struck from a KNOWN state between arms: note-ons on top of a held chord
# stack voices on a polyphonic synth, and cost that grows with the arm number
# is indistinguishable from a placement that does not pay.
restrike() { release; sleep 1; hold; }

# `mix <send0>` — track 0 at unity/centre, feeding bus 0 at the given amount and
# every other bus at zero. An unfed bus must cost nothing; that is the point of
# the early-outs in send_bus.rs, and a leak here would land in both arms.
mix() {
    local v b c
    for ((c = 0; c < CHAINS; c++)); do
        v="1.0,0.0,0"
        for ((b = 0; b < SEND_BUSES; b++)); do
            if [ "$b" -eq 0 ] && [ "$c" -lt "$FEEDERS" ]; then v="$v,$1"; else v="$v,0.0"; fi
        done
        ep "ch$c:mix" "$v"
    done
}

# `arm <send|insert> <chcolo> <label>` — put the FX in one place, take it out of
# the other, set the arm's flag, and read the wall.
arm() {
    ep "chcolo" "$2"
    if [ "$1" = "send" ]; then
        ep "ch$TRACK:fx1:module" ""
        sleep 2
        ep "snd0:module" "$FX"
        mix 1.0
    else
        ep "snd0:module" ""
        mix 0.0
        sleep 2
        ep "ch$TRACK:fx1:module" "$FX"
    fi
    sleep 4
    restrike
    sleep 2
    ts_ssh "> $LOG" >/dev/null 2>&1
    ep "chcostlog" "1"          # reset the window: discard the load and warm-up
    ep "sndcostlog" "1"
    sleep "$SETTLE"
    # Sampled INSIDE the window — `peaks` is the LAST rendered block, and read
    # after the window closed it reports chains silent that were sounding
    # throughout (a plaits LPG decays in the gap).
    ep "chpeaklog" "1"
    ep "chcostlog" "1"; sleep 1
    ep "sndcostlog" "1"; sleep 1
    ep "sndlog" "1"; sleep 1
    local cost sndc peaks
    cost=$(ts_ssh  "grep -o 'chain cost: .*'  $LOG | tail -n 1")
    sndc=$(ts_ssh  "grep -o 'send cost: .*'   $LOG | tail -n 1")
    peaks=$(ts_ssh "grep -o 'chain peaks: .*' $LOG | tail -n 1" | sed 's/chain peaks: //')
    ARM_WALL=$(printf '%s' "$cost" | sed -n 's/.*wall=\([0-9]*\)\/.*/\1/p')
    ARM_WALL="${ARM_WALL:-0}"
    # Chain 0's own mean, in ns — where an inserted FX shows up.
    ARM_CH0=$(printf '%s' "$cost" | sed 's/.*cost=//' | cut -d, -f1 | cut -d/ -f1)
    ARM_CH0="${ARM_CH0:-0}"
    # Bus 0's mean, in us — where a send FX shows up.
    ARM_BUS=$(printf '%s' "$sndc" | grep -oE '0:us=[0-9.]+' | cut -d= -f2)
    ARM_BUS="${ARM_BUS:-0}"
    ARM_SOUNDING=$(printf '%s' "$peaks" | tr ',' '\n' | awk '$1+0 > 0' | wc -l | tr -d ' ')
    # `colo=` is the arm's proof. A co-located bus sounds exactly like one in the
    # send phase and reports the same per-bus cost, so an arm whose co-location
    # was silently refused -- an unmeasured bus, a pinned feeder -- would print
    # as a measurement of a path it never took.
    ARM_COLO=$(ts_ssh "grep -o 'sends: .*' $LOG | tail -n 1" 2>/dev/null \
        | grep -oE 'colo=[0-9a-f]+' | cut -d= -f2)
    ARM_COLO="${ARM_COLO:-?}"
    printf '  %-11s wall %8.1f us   ch0 %7.1f us   bus0 %7.1f us   colo=%s  sounding %s/%s\n' \
        "$3" "$(awk -v v="$ARM_WALL" 'BEGIN{print v/1000}')" \
        "$(awk -v v="$ARM_CH0" 'BEGIN{print v/1000}')" "$ARM_BUS" "$ARM_COLO" \
        "$ARM_SOUNDING" "$CHAINS"
}

echo
echo "${BLD}=== arms ===${RST}"
arm send   0 "send";      S1=$ARM_WALL; S1B=$ARM_BUS; S1C=$ARM_CH0; SND1=$ARM_SOUNDING; C1=$ARM_COLO
arm send   1 "send+colo";  CW=$ARM_WALL; CB=$ARM_BUS;  CC=$ARM_CH0;  SNDC=$ARM_SOUNDING; CC_M=$ARM_COLO
if [ "$FEEDERS" -eq 1 ]; then
    arm insert 0 "insert";  IW=$ARM_WALL; IB=$ARM_BUS; IC=$ARM_CH0; SNDI=$ARM_SOUNDING
else
    IW=0; IB=0; IC=0; SNDI=$CHAINS
fi
arm send   0 "send-2";     S2=$ARM_WALL; S2B=$ARM_BUS; S2C=$ARM_CH0; SND2=$ARM_SOUNDING; C2=$ARM_COLO

release
ep "ch$TRACK:fx1:module" ""
ep "snd0:module" ""
for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" ""; done

# ── the arms have to BE the arms ────────────────────────────────────────────
#
# Each of these has failed in this repo's history: a write that never arrived,
# an FX that never loaded, a set that was not sounding. Any of them prints a
# beautiful saving that measures nothing.
echo
FAIL=0
[ "$EP_FAILS" -eq 0 ] || { echo "${RED}FAIL: $EP_FAILS engine writes never arrived${RST}"; FAIL=1; }
awk -v a="$S1B" -v b="$S2B" 'BEGIN{ exit !(a > 1 && b > 1) }' \
    || { echo "${RED}FAIL: a send arm reported bus0=$S1B/$S2B us — the bus never ran${RST}"; FAIL=1; }
if [ "$FEEDERS" -eq 1 ]; then
awk -v v="$IB" 'BEGIN{ exit !(v < 1) }' \
    || { echo "${RED}FAIL: the insert arm reported bus0=$IB us — the send was still fed${RST}"; FAIL=1; }
# The FX has to have MOVED, not merely vanished. Chain 0 must carry roughly what
# the bus was carrying; without this, an insert that failed to load reads as a
# total saving.
awk -v ic="$IC" -v sc="$S1C" -v bus="$S1B" 'BEGIN{ exit !((ic - sc)/1000 > bus * 0.5) }' \
    || { echo "${RED}FAIL: ch0 rose by $(awk -v a="$IC" -v b="$S1C" 'BEGIN{printf "%.1f", (a-b)/1000}') us, not the ~$S1B us the bus cost — did the insert load?${RST}"; FAIL=1; }
fi
[ "$C1" = "0" ] && [ "$C2" = "0" ] || { echo "${RED}FAIL: a chcolo 0 arm reported colo=$C1/$C2 -- the flag never reached the engine${RST}"; FAIL=1; }
if [ "$CC_M" = "1" ]; then
    echo "${GRN}the chcolo 1 arm co-located the bus (colo=1)${RST}"
else
    # NOT a harness failure with several feeders: a refusal is a RESULT. It says
    # the group would not fit a lane, which is what a precedence-aware scheduler
    # would fix and this one cannot.
    echo "${YEL}REFUSED: the chcolo 1 arm reported colo=$CC_M — the planner declined the group.${RST}"
    [ "$FEEDERS" -eq 1 ] && { echo "${RED}FAIL: a single feeder must always be offered a lane${RST}"; FAIL=1; }
fi
for s in "$SND1" "$SNDC" "$SNDI" "$SND2"; do
    [ "${s:-0}" -ge $((CHAINS * 2 / 3)) ] || { echo "${YEL}WARNING: only $s/$CHAINS chains sounding — silent chains cost their idle price and the set looks lighter than it is${RST}"; }
done

# ── the answer ──────────────────────────────────────────────────────────────
echo
awk -v s1="$S1" -v s2="$S2" -v c="$CW" -v i="$IW" -v bus="$S1B" 'BEGIN{
    s = (s1 + s2) / 2
    d = s1 - s2; if (d < 0) d = -d
    printf "send  (chcolo 0)  %8.1f us  (arms differ by %.1f us — the error bar)\n", s/1000, d/1000
    printf "send  (chcolo 1)  %8.1f us\n", c/1000
    if (i > 0) printf "insert            %8.1f us  (the target: what the same FX costs on the track)\n", i/1000
    printf "\ndelivered         %8.1f us  (%.1f%% of a 2902 us frame)\n", (s-c)/1000, (s-c)/29020
    if (i > 0) {
        printf "available         %8.1f us  (send minus insert)\n", (s-i)/1000
        printf "captured          %8.0f%% of it\n", (s-c)*100/(s-i)
    }
    if (s - c <= d) print "\nINCONCLUSIVE: the saving does not clear the drift between the chcolo 0 arms."
    if (i > 0 && c > i + d) print "\nSHORT: a co-located send still costs more than the insert. Something is left on the table."
}'
[ "$FAIL" -eq 0 ] || { echo "\n${RED}ARMS INVALID — the numbers above measure something else.${RST}"; exit 1; }
echo "${GRN}arms valid${RST}"
