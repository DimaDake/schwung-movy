#!/usr/bin/env bash
# Shared device-test fixture state. Sourced, never executed.
#
# Device tests used to assert against whatever set the device happened to hold
# and mutated it for each other, so results depended on run order. This puts
# every run on one known state.
#
# The state is applied with schwung's own set-switch verbs (see
# scripts/slot-state.mjs): `load_file` restores a slot's module AND every
# parameter value from a JSON file in schwung's slot format, `clear` empties a
# slot. Loading a module id alone would leave the slot's parameters wherever the
# last test dragged them, which is not a fixed state.
#
# Requires the sourcing script to define: HOST, MOVY_DIR.

TS_FIXTURE_DIR="$MOVY_DIR/scripts/fixtures/device-set"
TS_DEVICE_DIR=/data/UserData/schwung/_movy-fixture

ts_ssh() { ssh "ableton@$HOST" "$@"; }

# Line 1 of active_set.txt is the set UUID; line 2 is its display name.
ts_active_uuid() {
    ts_ssh "head -n 1 /data/UserData/schwung/active_set.txt 2>/dev/null || true" | tr -d '\r\n'
}

# "slot module" per line, comments and blanks stripped. One parser, so apply and
# verify can never disagree about what the fixture describes.
ts_fixture_entries() {
    sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$TS_FIXTURE_DIR/slots.txt"
}

# One slot's loaded synth id, retrying while the device stays silent. exit 3
# from module-slot.mjs means "no answer", which must never be read as "empty" —
# that is how a verify would accept a slot that never loaded.
ts_read_slot() {
    local slot="$1" cur rc try
    for try in 1 2 3; do
        # </dev/null: without it node inherits the caller's stdin and eats the
        # rest of the fixture entries when called from a read loop.
        cur=$(node "$MOVY_DIR/scripts/module-slot.mjs" get "$slot" synth </dev/null 2>/dev/null)
        rc=$?
        [ $rc -eq 0 ] && { printf '%s' "$cur"; return 0; }
        sleep 1
    done
    return 1
}

# Ship the fixture to a directory schwung does not own. Anything kept under
# set_state/<uuid>/ is autosaved over with whatever is currently loaded, so a
# fixture stored there quietly becomes a copy of the last test's mess.
ts_push_fixture() {
    ts_ssh "mkdir -p $TS_DEVICE_DIR" || return 1
    local slot mod
    while read -r slot mod; do
        [ -z "${slot:-}" ] && continue
        [ "$mod" = "none" ] && continue
        scp -q "$TS_FIXTURE_DIR/slot_${slot}.json" "ableton@$HOST:$TS_DEVICE_DIR/slot_${slot}.json" || return 1
    done < <(ts_fixture_entries)
}

ts_apply() {
    local slot mod cur
    while read -r slot mod; do
        [ -z "${slot:-}" ] && continue
        if [ "$mod" = "none" ]; then
            node "$MOVY_DIR/scripts/slot-state.mjs" clear "$slot" </dev/null >/dev/null 2>&1
            sleep 1
            continue
        fi
        # load_file acts on the slot's existing chain instance: it is a no-op on
        # an empty slot, and on a slot holding a DIFFERENT module it empties the
        # slot rather than switching it. So put the right module in place first
        # whenever the slot does not already hold it; load_file then restores
        # that module's parameter values on top.
        cur=$(ts_read_slot "$slot") || return 1
        if [ "$cur" != "$mod" ]; then
            node "$MOVY_DIR/scripts/slot-state.mjs" module "$slot" "$mod" </dev/null >/dev/null 2>&1
            sleep 3
        fi
        node "$MOVY_DIR/scripts/slot-state.mjs" load "$slot" "$TS_DEVICE_DIR/slot_${slot}.json" </dev/null >/dev/null 2>&1
        sleep 2
    done < <(ts_fixture_entries)
}

# Read every slot back and compare with the fixture. Never infer that an apply
# worked: running on the wrong state while reporting success is the failure this
# library exists to remove.
ts_verify() {
    local slot mod cur bad=0
    while read -r slot mod; do
        [ -z "${slot:-}" ] && continue
        cur=$(ts_read_slot "$slot") || { echo "test-set: no answer reading slot $slot" >&2; return 1; }
        [ "$mod" = "none" ] && mod=""
        if [ "$cur" != "$mod" ]; then
            echo "test-set: slot $slot is '${cur:-<empty>}', fixture wants '${mod:-<empty>}'" >&2
            bad=1
        fi
    done < <(ts_fixture_entries)
    [ $bad -eq 0 ] || { echo "test-set: fixture did not take (is every fixture module installed?)" >&2; return 1; }
}

# movy reads seq-state.json when it opens and autosaves over it every ~3 s, so
# the fixture can only be written with movy closed. Back x3 walks
# knobs -> chain -> exit.
ts_close_movy() {
    local i
    for i in 1 2 3; do
        python3 "$MOVY_DIR/../schwung-midi-inject-ui.py" "$HOST" cc 51 127 >/dev/null 2>&1
        sleep 0.12
        python3 "$MOVY_DIR/../schwung-midi-inject-ui.py" "$HOST" cc 51 0 >/dev/null 2>&1
        sleep 0.15
    done
    sleep 0.8
}

ts_seq_path() {
    local uuid; uuid=$(ts_active_uuid)
    echo "/data/UserData/schwung/modules/tools/movy/sets/${uuid:-_default}/seq-state.json"
}

# The sequencer half of the fixture: known tempo/swing, one clip per playable
# track, and a pre-seeded automation lane so the reselect test has one without
# depending on the automation test having run first.
#
# The file carries neither a `gen` line nor an `end` trailer on purpose: movy
# accepts that as a legacy blob at generation 0 (src/seq/persist-blob.ts), so
# the fixture needs no checksum and stays readable and hand-editable. A `gen`
# line without a matching trailer would be rejected as a torn write.
ts_seq_apply() {
    local p; p=$(ts_seq_path)
    ts_ssh "mkdir -p \"\$(dirname '$p')\"" || return 1
    scp -q "$TS_FIXTURE_DIR/seq-state.json" "ableton@$HOST:$p"
}

# Apply, then confirm; retry the whole thing if it did not land. Chain loads
# settle at their own pace — a slot can still read empty seconds after the shim
# logged the load — so a single pass is not dependable. Verification is what
# makes the retry safe: we never proceed on an unconfirmed state.
test_set_begin() {
    local try
    ts_push_fixture || { echo "test-set: could not ship the fixture to the device" >&2; return 1; }
    # movy must be shut before the sequencer state is written, or it autosaves
    # its in-memory copy straight back over the fixture within a few seconds.
    ts_close_movy
    ts_seq_apply || { echo "test-set: could not install the fixture sequencer state" >&2; return 1; }
    for try in 1 2 3; do
        ts_apply || true
        if ts_verify 2>/dev/null; then
            [ "$try" -gt 1 ] && echo "test-set: fixture established on attempt $try" >&2
            return 0
        fi
        sleep 3
    done
    ts_verify   # once more, letting it print what is actually wrong
}
