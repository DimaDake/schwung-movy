#!/usr/bin/env bash
#
# Device e2e: the voice slot, on a real per-voice kit.
#
# What no host build can reach: the config on the DEVICE is the one the module
# ships, and a pad note really travels through schwung's overtake ring into
# movy's router. The logic suite proves the model against a fixture copy; this
# proves the shipped module and the wire agree with it.
#
# Asserted:
#   1. the kit's config loads, and the rotation is ONE seat for the voices plus
#      one for each page without a voice — not one seat per bank
#   2. a real pad note-on moves the voice slot to that voice
#   3. the same pad pressed while on a page WITHOUT a voice does not turn the
#      page — the whole point of scoping pad-follow to voice pages
#   4. and the jog still walks the collapsed rotation
#
#   ./scripts/test-voice-slot.sh [host] [kit]      (default: move.local 8w8)
set -uo pipefail

HOST="${1:-move.local}"
KIT="${2:-8w8}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
MOVY_DIR="$SRC"          # the library requires HOST and MOVY_DIR to be set
# shellcheck source=lib/test-set.sh
source "$SRC/scripts/lib/test-set.sh"

fails=0
ok()  { printf '  \033[0;32m✓\033[0m %s%s\n' "$1" "${2:+  ($2)}"; }
bad() { printf '  \033[0;31m✗\033[0m %s%s\n' "$1" "${2:+  ($2)}"; fails=$((fails+1)); }
is()  { if [ "$2" = "$3" ]; then ok "$1" "$2"; else bad "$1" "want $3, got $2"; fi; }

# One probe = one ssh round trip: clear the log, inject, poll, dump.
probe() { "$SRC/scripts/dev-probe.sh" log "$HOST" "$@" 2>/dev/null; }
# The PHYSICAL note a Move pad sends (68..99), not the module's drum-rack note.
# Injecting the rack note (36 + N - 1) put every event below PAD_MIN, so the
# router never saw a pad at all and the suite read that as movy ignoring it.
# Asked of movy's own drum-grid so the test and the app cannot drift apart.
pad_note() {
    node -e "import('$SRC/dist/esm/keyboard/drum-grid.js').then(g=>console.log(
        g.physPadOfDrumPad($1, 68, {padCount:$VOICES,padNoteStart:36,rawMidi:false})))"
}
note_ev() { echo "0x09:0x90:$(pad_note "$1"):127:0.05"; }
off_ev()  { echo "0x08:0x80:$(pad_note "$1"):0:0"; }
jog_ev()  { echo "0x0B:0xB0:14:$1"; }          # 1 = forward, 127 = back

test_set_begin
trap test_set_end EXIT INT TERM

# Expectations come from the config movy will actually USE — its bundled copy —
# not from this script's memory of it. A kit that re-orders its banks changes
# what is asserted here.
read -r VOICES TAIL V2 <<EOF
$(python3 -c "
import json
b = json.load(open('$SRC/src/module-configs/$KIT.json'))['banks']
v = [x for x in b if 'pad' in x]; t = [x for x in b if 'pad' not in x]
print(len(v), len(t), v[1]['name'])
" 2>/dev/null)
EOF
[ -n "${VOICES:-}" ] || { echo "movy ships no override config for $KIT" >&2; exit 1; }
echo "== $KIT: $VOICES voices, $TAIL pages without one (from movy's bundled config)"

# The override is only under test if the DEVICE is serving something different.
# Without this the suite would pass just as well on a device that happened to
# have movy's own config installed — which is exactly how it was set up before,
# and it would have proved nothing about OVERRIDES_MODULE_FILE.
dev_voices="$(ssh "ableton@$HOST" "python3 -c \"
import json
b = json.load(open('/data/UserData/schwung/modules/sound_generators/$KIT/movy_config.json'))['banks']
print(sum(1 for x in b if 'pad' in x), len(b), b[0].get('pad') is not None)
\"" 2>/dev/null)"
set -- $dev_voices
if [ "${3:-}" = "False" ] || [ "$1" != "$VOICES" ]; then
    ok "the device serves a DIFFERENT config, so the override is live" \
       "device: $1/$2 banks have pads, first-is-voice=${3:-?}"
else
    bad "the device serves a DIFFERENT config, so the override is live" \
        "device config already matches movy's — nothing is being overridden"
fi

ts_open_movy
ts_focus_track0
# Borrow the synth slot AFTER movy is open: a cold chain slot cannot load its
# first module through the remote-UI ring (dropped silently) — the fixture's
# own boot-path constraint.
ts_load_component 0 synth "$KIT"
sleep 3

# OPEN THE MODULE PAGE. movy starts in the chain view, where the jog walks the
# CHAIN and turns no pages at all — the first draft of this suite injected jogs
# there, logged `chain chainIndex=3`, and read the resulting silence as three
# clean failures plus one vacuous pass. Walk to the synth slot, then click.
CHAIN_SYNTH=1                        # CHAIN_SLOTS: midi_fx1, synth, fx1, fx2, lfo
# Walk to the LEFT end first (the jog clamps at 0), then forward one. Counting
# steps back from wherever movy happened to be is how this landed on slot 0.
out="$(probe -p 'chain chainIndex' -i "$(jog_ev 127)" -i "$(jog_ev 127)" \
             -i "$(jog_ev 127)" -i "$(jog_ev 127)" -i "$(jog_ev 127)" \
             -i "$(jog_ev 1)")"
at="$(echo "$out" | grep -oE 'chainIndex=[0-9]+' | tail -1 | cut -d= -f2)"
is "walked the chain to the synth slot" "${at:-none}" "$CHAIN_SYNTH"
probe -p 'view|knobPage' -i '0x0B:0xB0:3:127' -i '0x0B:0xB0:3:0' >/dev/null
sleep 1

# 1. The rotation. movy logs each page turn as `pos N/LEN`, and LEN is the
#    number of dots the bank bar draws.
out="$(probe -p 'changePage delta' -i "$(jog_ev 1)")"
rot="$(echo "$out" | grep -oE 'pos [0-9]+/[0-9]+' | tail -1 | cut -d/ -f2)"
is "the rotation is one voice seat plus $TAIL" "${rot:-none}" "$((TAIL + 1))"
# Control. Written as `${rot:-0} -lt $VOICES` first, which PASSED when nothing
# was measured at all — 0 is less than 16. A missing number is not a collapse.
if [ -n "${rot:-}" ] && [ "$rot" -lt "$VOICES" ]; then
    ok "which is fewer seats than the $VOICES voices"
else
    bad "which is fewer seats than the $VOICES voices" "rot=${rot:-unmeasured}"
fi

# 2. A real pad note-on selects that voice. Jog back to the voice slot first —
#    that also proves the log is live, so the silence asserted in 3 is the
#    guard rather than a dead harness.
probe -p 'changePage delta' -i "$(jog_ev 127)" >/dev/null
out="$(probe -p 'selectBankForPad' -i "$(note_ev 2)" -i "$(off_ev 2)")"
if echo "$out" | qgrep 'selectBankForPad pad=2'; then
    ok "a pad note-on selects that voice" "$V2"
else
    bad "a pad note-on selects that voice" "nothing selected"
fi

# 3. The same press from a page WITHOUT a voice must leave the page alone.
#    selectBankForPad only logs when the page moves, so silence is the claim.
probe -p 'changePage delta' -i "$(jog_ev 1)" >/dev/null
#    Silence only means something if the pad reached movy at all, so grep for
#    the note as well: drumPadOn logs every pad it resolves, whether or not the
#    page moves. Without this the assertion passes on a dead harness — which is
#    exactly what it did when movy was still sitting in the chain view.
out="$(probe -p 'drumPad|selectBankForPad' -t 4 -i "$(note_ev 1)" -i "$(off_ev 1)")"
if ! echo "$out" | qgrep -E 'drumPad|padOn'; then
    bad "a pad on a page without a voice leaves the page alone" "the pad never arrived"
elif echo "$out" | qgrep 'selectBankForPad'; then
    bad "a pad on a page without a voice leaves the page alone" "the page moved"
else
    ok "a pad on a page without a voice leaves the page alone"
fi

# 4. And the jog still walks it, back onto the voice slot.
out="$(probe -p 'changePage delta' -i "$(jog_ev 127)")"
if echo "$out" | qgrep 'changePage delta=-1'; then
    ok "the jog comes back to the voice slot"
else
    bad "the jog comes back to the voice slot" "no page turn logged"
fi

echo
if [ "$fails" -eq 0 ]; then
    printf '\033[0;32m\033[1mALL VOICE-SLOT CHECKS PASSED\033[0m\n'
else
    printf '\033[0;31m\033[1m%d VOICE-SLOT CHECK(S) FAILED\033[0m\n' "$fails"
    exit 1
fi
