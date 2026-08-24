#!/usr/bin/env bash
# chain-equiv.sh — the three-arm digest protocol, shared.
#
# Extracted from measure-render-equivalence.sh when measure-chain-idle.sh needed
# the same thing for a different flag. The protocol is subtle enough that a
# second copy would have been a second set of the same mistakes — and the first
# copy already paid for two of them:
#
# WHY THREE ARMS, NOT TWO. Most synths are not reproducible across arms. The
# modules are perfectly deterministic — two dexed instances hash identically
# INSIDE any one arm — but state survives from one arm to the next, so a second
# arm begins wherever the first left off. Voice-allocator position and
# free-running LFO phase are the usual carriers, and neither is something a gap
# can wait out. So the control arm BRACKETS the arm under test: only a chain
# whose two control arms agree can say anything about the arm between them.
#
# WHY EVERY ARM RELOADS. A load request is never deduplicated, so re-setting the
# same module really does re-instantiate the chain. That is what makes A and A'
# start from the same place rather than merely running the same code.
#
# The caller must have sourced test-set.sh and chain-bench.sh, and must define:
#   HOST CHAINS ASSIGN[] LOG BLOCKS WINDOW_WAIT GAP  and the colour vars.
# `CE_FLAG` names the engine flag each arm sets before it loads; the arm's
# argument is that flag's value.

CE_FLAG="${CE_FLAG:-chparallel}"

# Redirected wholesale to stderr: this runs INSIDE the command substitution that
# captures the digest, so a single stray `echo` — here or in a future
# `cb_prepare` — would be prepended to the digest string and the scorer would
# split it into nonsense while still printing a confident verdict.
ce_load_chains() {
    for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" "${ASSIGN[$c]}"; done
    sleep $((CHAINS + 6))
    for c in $(seq 0 $((CHAINS-1))); do cb_prepare "${ASSIGN[$c]}" "$c"; done
    sleep 2
} >&2

# One armed window -> the per-chain digest line. The engine strikes and releases
# its own chord from inside the render, so nothing about network timing can
# reach the measurement.
ce_digest() {  # ce_digest <label> -> "<hex>/<voiced>,..."
    ssh "ableton@$HOST" "> $LOG"
    ep "chdigest" "$BLOCKS"
    sleep "$WINDOW_WAIT"
    local line
    line=$(ssh "ableton@$HOST" "grep -o 'chain digest: state=done.*' $LOG | tail -n 1")
    if [ -z "$line" ]; then
        echo "${RED}the window never closed in arm $1 — is the build deployed?${RST}" >&2
        echo ""
        return
    fi
    printf '%s' "$line" | sed 's/.*d=//'
}

# The flag is set BEFORE the reload so every arm loads under the conditions it
# will render under, and the reload is what makes the arms comparable at all.
ce_arm() {  # ce_arm <label> <flag value>  -> "<hex>/<voiced>,..." on stdout
    # stderr, because stdout of this function IS the digest.
    echo "${BLD}$1${RST}" >&2
    ep "$CE_FLAG" "$2"
    ce_load_chains
    ce_digest "$1"
}
