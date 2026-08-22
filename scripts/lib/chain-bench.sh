# chain-bench.sh — shared helpers for benchmarks that load movy's twelve chains.
#
# The preset/polyphony table below is the whole reason this file exists. Several
# fleet synths default to a monophonic preset or an empty kit, so a held chord
# costs one voice and the benchmark quietly measures almost nothing — a bug that
# looks exactly like "this synth is cheap". A fix found by one benchmark has to
# reach the other, so the table lives in one place.
#
# Requires: $HOST, and cwd = the movy repo root (for scripts/engine-param.mjs).
# Provides: ep, cb_discover_samples, cb_pitches (-> $CB_P), cb_prepare.

CB_MELODIC=(60 64 67 71)
CB_DRUMS=(36 37 38 39)
CB_SAMPLES=()

# Write one movy ENGINE param. The remote-UI socket is write-only, so this is
# also how a test asks the engine to LOG something it wants to read back.
ep() { node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1; }

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
