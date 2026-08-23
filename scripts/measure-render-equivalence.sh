#!/usr/bin/env bash
#
# The serial/parallel equivalence oracle: does parallel render produce the SAME
# AUDIO as serial render?
#
# Every other measurement in this repo asks whether parallel render is faster.
# None has ever asked whether it is correct — `chain peaks` says a chain made a
# sound, which a race that drops, doubles or reorders samples passes trivially.
# This is the gate on `chparallel` ever defaulting to on.
#
# WHAT IT COMPARES. `chdigest` checksums exactly N blocks of every chain's
# output, striking its own chord from inside the render so both arms get an
# identical stimulus on an identical block. Bit-identical is the right bar and
# is achievable: per-chain buffers, the same FPCR flush-to-zero flag on every
# worker, and a mix that stays serial in slot order after the join.
#
# WHY THERE ARE THREE ARMS, NOT TWO. Most synths are not reproducible even
# single-threaded — free-running LFOs, noise, undecayed tails. Diffing serial
# against parallel alone would light up for reasons that have nothing to do with
# threading, and a day would go into chasing it. So the run is A, B, A': the
# serial control BRACKETS the parallel arm in time, and a chain only counts as
# evidence if A == A'. That also makes the oracle report its own coverage, which
# is the difference between "all twelve agreed" and "all twelve were silent".
#
#   ./scripts/measure-render-equivalence.sh [host] [lanes]
#
set -uo pipefail
HOST="${1:-move.local}"
LANES="${2:-3}"
MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
source "$MOVY_DIR/scripts/lib/chain-bench.sh"
# The same fleet the speed measurements are scored on — coverage here only means
# something if it covers the modules those runs packed into lanes.
MODULES=("${CB_DEFAULT_MODULES[@]}")
LOG=/data/UserData/schwung/debug.log
CHAINS=12
# Blocks per window. ~344 blocks/s, so 512 is ~1.5 s of audio: long enough for a
# rare race to land inside it, short enough that most of it is not decay.
BLOCKS="${BLOCKS:-512}"
# Generous: the window itself is ~1.5 s and the log read is a round trip behind.
WINDOW_WAIT=6
# Between arms, so the previous arm's release tails do not bleed into the next
# window and cost reproducibility that threading never touched.
GAP=4
BLD=$'\033[1m'; RST=$'\033[0m'; GRN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

echo "${BLD}=== render equivalence: does parallel produce the same audio? ===${RST}"
echo "host=$HOST  lanes=$LANES  window=$BLOCKS blocks  modules: ${MODULES[*]}"

ts_open_movy
sleep 8
cb_require_engine_link
cb_discover_samples

ASSIGN=()
for c in $(seq 0 $((CHAINS-1))); do
    ASSIGN+=("${MODULES[$((c % ${#MODULES[@]}))]}")
done

echo
echo "chain assignment:"
for c in $(seq 0 $((CHAINS-1))); do printf '  ch%-3s %s\n' "$c" "${ASSIGN[$c]}"; done

# Every arm gets FRESHLY INSTANTIATED chains. The first run of this script did
# not, and all twelve chains came back "not reproducible": the modules are
# perfectly deterministic — two dexed instances hashed identically inside every
# arm — but state survives from one arm to the next, so arm A' begins where arm
# B left off. Voice-allocator position and free-running LFO phase are the usual
# carriers, and neither is something a gap can wait out. A load request is never
# deduplicated, so re-setting the same module is a real re-instantiation.
#
# Redirected wholesale to stderr: this runs INSIDE the command substitution that
# captures the digest, so a single stray `echo` — here or in a future
# `cb_prepare` — would be prepended to the digest string and the scorer would
# split it into nonsense while still printing a confident verdict.
load_chains() {
    for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" "${ASSIGN[$c]}"; done
    sleep $((CHAINS + 6))
    for c in $(seq 0 $((CHAINS-1))); do cb_prepare "${ASSIGN[$c]}" "$c"; done
    sleep 2
} >&2

# One armed window -> the per-chain digest line. The engine strikes and releases
# its own chord, so nothing about network timing can reach the measurement.
digest() {  # digest <label> -> "<hex>/<voiced>,..."
    ssh "ableton@$HOST" "> $LOG"
    ep "chdigest" "$BLOCKS"
    sleep "$WINDOW_WAIT"
    local line
    line=$(ssh "ableton@$HOST" "grep -o 'chain digest: state=done.*' $LOG | tail -n 1")
    if [ -z "$line" ]; then
        echo "${RED}the window never closed in arm $1 — is 0.39.0 deployed?${RST}" >&2
        echo ""
        return
    fi
    printf '%s' "$line" | sed 's/.*d=//'
}

# The mode is set BEFORE the reload so every arm loads under the conditions it
# will render under, and the reload is what makes the arms comparable at all.
arm() {  # arm <label> <parallel 0|1>  -> "<hex>/<voiced>,..." on stdout
    # stderr, because stdout of this function IS the digest.
    echo "${BLD}$1${RST}" >&2
    ep "chparallel" "$2"
    load_chains
    digest "$1"
}

echo
A=$(arm "A: serial — the control, first half" 0)
sleep "$GAP"
ep "chlanes" "$LANES"
B=$(arm "B: parallel, $LANES lane(s) — the arm under test" 1)
# Which lane each chain actually ran on, read while the parallel arm's plan is
# still current. A chain pinned to lane 0 rendered on the audio thread exactly as
# it does serially, so "identical" there is close to tautological — the verdict
# has to be able to tell those apart from chains that ran on a helper.
ep "chrenderlog" "1"
sleep 1
PLAN=$(ssh "ableton@$HOST" "grep -o 'chain render: .*' $LOG | tail -n 1")
PLAN="${PLAN#*plan=}"
sleep "$GAP"
A2=$(arm "A': serial again — the control, second half" 0)

# Leave the device as it was found: the engine releases its own chord, but the
# mode is a session setting and a later benchmark must not inherit it.
ep "chparallel" "0"

# Shape check, not just emptiness. The scorer splits on "," and "/" and will
# happily score whatever it is handed, so a digest with anything else in it
# would produce a verdict rather than an error.
#
# `[[ =~ ]]` and not `grep -E`: grep anchors per LINE, so a digest with a stray
# line in front of it matches on the second line and passes. Bash matches the
# whole string, which is the property being asserted.
SHAPE="^([0-9a-f]{16}/[0-9]+,){$((CHAINS-1))}[0-9a-f]{16}/[0-9]+$"
for d in "$A" "$B" "$A2"; do
    if ! [[ $d =~ $SHAPE ]]; then
        echo "${RED}an arm did not return $CHAINS well-formed digests — nothing can be concluded${RST}"
        echo "  got: ${d:-<empty>}"
        exit 1
    fi
done

echo
echo "${BLD}per chain${RST}"
printf '  %-5s %-9s %-6s %-18s %-18s %s\n' ch module lane serial parallel verdict

RESULT=$(awk -v a="$A" -v b="$B" -v a2="$A2" -v mods="${ASSIGN[*]}" -v n="$CHAINS" \
             -v plan="$PLAN" \
             -v G="$GRN" -v R="$RED" -v Y="$YEL" -v Z="$RST" \
             -f "$MOVY_DIR/scripts/lib/digest-verdict.awk")
printf '%s\n' "$RESULT" | grep -v '^SUMMARY'
read -r _ PASS FAIL SILENT UNSTABLE EXPOSED <<<"$(printf '%s' "$RESULT" | grep '^SUMMARY')"

echo
echo "${BLD}verdict${RST}"
printf '  %-34s %s/%s\n' "chains that are evidence" "$((PASS + FAIL))" "$CHAINS"
printf '  %-34s %s\n'    "  silent in some arm" "$SILENT"
printf '  %-34s %s\n'    "  not reproducible serially" "$UNSTABLE"
printf '  %-34s %s\n'    "passing chains run on a HELPER lane" "$EXPOSED"
echo
if [ "$FAIL" -gt 0 ]; then
    echo "${RED}${BLD}FAIL: $FAIL chain(s) rendered different audio in parallel.${RST}"
    echo "  chparallel must not default on."
    exit 1
elif [ "$PASS" -eq 0 ]; then
    # The dangerous outcome: zero differences because zero chains could be
    # compared. It has to read as a failed measurement, not as a pass.
    echo "${YEL}${BLD}INCONCLUSIVE: no chain was reproducible enough to compare.${RST}"
    echo "  The oracle proved nothing. Do not read this as equivalence."
    exit 1
elif [ "$EXPOSED" -eq 0 ]; then
    # Every comparable chain stayed on the audio thread, where the parallel path
    # renders it exactly as the serial path does. Nothing was actually tested.
    echo "${YEL}${BLD}INCONCLUSIVE: every passing chain ran on lane 0.${RST}"
    echo "  Those render on the audio thread in both arms, so matching proves nothing."
    exit 1
else
    echo "${GRN}${BLD}PASS: $PASS comparable chain(s) rendered bit-identical audio.${RST}"
    printf '  %d of them ran on a helper lane, so concurrency was genuinely exercised.\n' "$EXPOSED"
    printf '  Coverage is %d of %d chains — the rest were not testable this way.\n' \
        "$PASS" "$CHAINS"
fi
