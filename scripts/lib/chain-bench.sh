# chain-bench.sh — shared helpers for benchmarks that load movy's twelve chains.
#
# The preset/polyphony table below is the whole reason this file exists. Several
# fleet synths default to a monophonic preset or an empty kit, so a held chord
# costs one voice and the benchmark quietly measures almost nothing — a bug that
# looks exactly like "this synth is cheap". A fix found by one benchmark has to
# reach the other, so the table lives in one place.
#
# Requires: $HOST, and cwd = the movy repo root (for scripts/engine-param.mjs).
# Provides: ep, cb_discover_samples, cb_pitches (-> $CB_P), cb_prepare,
#           cb_frame_field, cb_frame_total.

CB_MELODIC=(60 64 67 71)
CB_DRUMS=(36 37 38 39)
CB_SAMPLES=()

# The benchmark fleet: eight modules spanning the cost range, which every chain
# measurement in this repo is scored on. Shared because the measurements are
# compared against EACH OTHER — the balance run prices the lanes the parallel
# run packs, and the equivalence run has to cover the same modules for either to
# mean anything. Three scripts kept their own copy of this line.
CB_DEFAULT_MODULES=(plaits obxd dexed noisemaker helm forge weird-dreams surge)

# Write one movy ENGINE param. The remote-UI socket is write-only, so this is
# also how a test asks the engine to LOG something it wants to read back.
#
# Failures are COUNTED, not swallowed. `engine-param.mjs` exits non-zero when it
# cannot reach the socket at all, and a lost write looks exactly like a write
# that changed nothing: a whole sweep once ran to a conclusion — chains loaded,
# notes held, arms sampled — with every single write dropped, because $HOST was
# an ssh alias the WebSocket could not resolve.
EP_FAILS=0
ep() {
    node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1 \
        || { EP_FAILS=$((EP_FAILS + 1)); return 1; }
}

# Refuse to start a benchmark whose device writes are going nowhere. `chcostlog`
# is the probe because it is idempotent and the engine answers it in the log, so
# this checks the whole path — socket, engine, logging — not just the socket.
cb_require_engine_link() {
    ep "chcostlog" "1" || {
        echo "ENGINE UNREACHABLE at $HOST — engine-param.mjs could not open the socket."
        echo "  The host must resolve for BOTH ssh and the WebSocket on port 7700;"
        echo "  an ssh-config alias resolves for one and not the other. Use the IP."
        exit 1
    }
}

# Real sample files, discovered on the device rather than hardcoded — a path
# that does not exist loads nothing, and the sampler modules then measure
# silence while still reporting a successful load.
cb_discover_samples() {
    CB_SAMPLES=()
    while IFS= read -r line; do [ -n "$line" ] && CB_SAMPLES+=("$line"); done < <(
        ssh "ableton@$HOST" 'find /data/UserData -iname "*.wav" 2>/dev/null | head -n 4' 2>/dev/null
    )
    [ ${#CB_SAMPLES[@]} -gt 0 ] \
        && echo "samples: ${#CB_SAMPLES[@]} found (${CB_SAMPLES[0]##*/} ...)" \
        || echo "samples: NONE FOUND — sampler modules will be silent"
}

# cb_pitches <module> — sets $CB_P to pitches that module actually responds to.
cb_pitches() {
    case "$1" in
        mrdrums|weird-dreams|forge|krautdrums) CB_P=("${CB_DRUMS[@]}") ;;
        *) CB_P=("${CB_MELODIC[@]}") ;;
    esac
}

# cb_prepare <module> <chain> — presets/polyphony that make a chord cost four
# voices on that one chain.
cb_prepare() {
    local m="$1" c="$2" i
    case "$m" in
        # Preset 1 is monophonic; 9 is the polyphonic one.
        noisemaker) ep "ch$c:synth:preset" "9" ;;
        # The LPG decays a HELD note to silence; at the 0.5 default plaits is
        # inaudible a couple of seconds after the strike and reads as free.
        plaits)      ep "ch$c:synth:decay" "1" ;;
        # Preset 0 is silent and preset 5 nearly so (measured peaks 0 and 10 of
        # 32767). 12 is the first that clearly sounds.
        dexed)       ep "ch$c:synth:preset" "12" ;;
        helm|freak)  ep "ch$c:synth:polyphony" "16" ;;
        obxd)        ep "ch$c:synth:voice_count" "16" ;;
        mrdrums)
            ep "ch$c:synth:g_polyphony" "4"
            for i in 1 2 3 4; do
                [ -n "${CB_SAMPLES[$((i-1))]:-}" ] && \
                    ep "ch$c:synth:p0${i}_sample_path" "${CB_SAMPLES[$((i-1))]}"
            done ;;
        # Kit 0 is the init kit and is silent; any loaded kit has real voices.
        weird-dreams) ep "ch$c:synth:kit" "3" ;;
        forge)        ep "ch$c:synth:kit" "5" ;;
        *) : ;;
    esac
}

# --- the shim's own frame timing -----------------------------------------
#
# The SHIM's numbers, not the engine's, and the difference matters. movy's
# `chcostlog` only accumulates wall time on a block where at least one chain
# rendered, so once `chidle` puts a set to sleep the engine reports ~0 however
# much the render path cost — including a parallel fan-out woken for empty
# lanes. `Frame(us): pre=.. post=..` is measured around the whole callback and
# cannot be fooled that way.
#
# Averaged over the last few log lines because a single frame is noise; both
# readers need $HOST and $LOG.

cb_frame_field() {  # cb_frame_field <pre|ioctl|post> -> mean us
    ssh "ableton@$HOST" "grep -o 'Frame(us):.*' $LOG | tail -n 5" \
        | awk -v want="$1" '{ for (i=1;i<=NF;i++) if ($i==want) { split($(i+1),a,"="); s+=a[2]+0; n++ } }
                             END { print (n? int(s/n):0) }'
}

cb_frame_total() {  # -> mean us
    ssh "ableton@$HOST" "grep -o 'total avg=[0-9]*' $LOG | tail -n 5" \
        | awk -F= '{ s+=$2+0; n++ } END { print (n? int(s/n):0) }'
}

# What a frame actually spent working: pre + post, excluding the ioctl wait.
# This is the number every ceiling in docs/track-performance.md is stated in.
cb_frame_work() {  # -> mean us
    echo $(( $(cb_frame_field pre) + $(cb_frame_field post) ))
}
