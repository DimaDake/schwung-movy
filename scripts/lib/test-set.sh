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

# Wait until a slot reports the module we asked for. Chain loads settle at their
# own pace — anywhere from under a second to several — so a fixed sleep either
# wastes time or gives up too early; both happened before this polled.
ts_wait_slot() {
    local slot="$1" want="$2" waited=0 cur
    while [ $waited -lt 20 ]; do
        cur=$(ts_read_slot "$slot") || return 1
        [ "$cur" = "$want" ] && return 0
        sleep 2; waited=$((waited + 2))
    done
    return 1
}

ts_apply() {
    local slot mod cur
    while read -r slot mod; do
        [ -z "${slot:-}" ] && continue
        if [ "$mod" = "none" ]; then
            node "$MOVY_DIR/scripts/slot-state.mjs" clear "$slot" </dev/null >/dev/null 2>&1
            ts_wait_slot "$slot" "" || true
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
            ts_wait_slot "$slot" "$mod" || continue   # let the outer retry re-try
        fi
        node "$MOVY_DIR/scripts/slot-state.mjs" load "$slot" "$TS_DEVICE_DIR/slot_${slot}.json" </dev/null >/dev/null 2>&1
        ts_wait_slot "$slot" "$mod" || true
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

# Press and release in ONE ssh round trip.
#
# schwung-midi-inject-ui.py sends a single message per invocation and each costs
# ~0.5 s of network, so a press/release pair driven from the shell is a >500 ms
# hold. movy reads long holds as different gestures than taps: a step held past
# STEP_AUTO_MS (300 ms) becomes an automation hold whose release does NOT enter
# a note, and a held track button is momentary — it reverts to the previous
# track when released. Both silently did the opposite of what the tests meant.
# Each argument is one message as head:status:d1:d2:sleep_after, all delivered in
# a single device-side script so the gaps between them are milliseconds rather
# than round trips. That is what makes a hold-one-press-another gesture
# expressible at all from the shell.
ts_send() {
    local msg py="
import mmap, time
def send(head, status, d1, d2):
    with open('/dev/shm/schwung-ui-midi', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 256)
        for slot in range(0, 256, 4):
            if mm[slot] == 0:
                mm[slot+1] = status; mm[slot+2] = d1; mm[slot+3] = d2
                mm[slot] = head
                break
        mm.close()
    with open('/dev/shm/schwung-control', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 72)
        mm[3] = (mm[3] + 1) % 256
        mm.close()
"
    for msg in "$@"; do
        # `st` not `status`: that name is read-only in zsh, so a zsh caller
        # sourcing this file would die here.
        IFS=':' read -r head st d1 d2 nap <<< "$msg"
        py="${py}
send(${head}, ${st}, ${d1}, ${d2})
time.sleep(${nap:-0.05})"
    done
    ts_ssh "python3 -c \"$py\"" >/dev/null 2>&1
}

ts_tap_cc() {
    ts_send "0x0B:0xB0:$1:${2:-127}:0.05" "0x0B:0xB0:$1:0:0"
}
ts_tap_note() {
    ts_send "0x09:0x90:$1:${2:-127}:0.05" "0x08:0x80:$1:0:0"
}
# Hold one step while tapping another — the drum multi-entry gesture.
ts_tap_two_steps() {
    ts_send "0x09:0x90:$1:127:0.08" "0x09:0x90:$2:127:0.08" \
            "0x08:0x80:$2:0:0.08"    "0x08:0x80:$1:0:0"
}

# Block until movy's per-set UI blob on disk matches $1 (an extended regex), or
# fail after ~30 s.
#
# The autosave is tick-based: SAVE_TICKS = 600, documented as ~3 s "at the
# ~205 Hz device rate". This device measures 63-90 Hz, so the real interval is
# nearer 8 s and moves with load. Any fixed sleep is therefore a race — a test
# that slept 4 s and reopened read the PREVIOUS blob and blamed persistence.
ts_wait_ui_state() {
    local want="$1" waited=0 cur
    while [ $waited -lt 30 ]; do
        cur=$(ts_ssh "cat '$(ts_ui_path)' 2>/dev/null || true")
        echo "$cur" | grep -qE "$want" && return 0
        sleep 2; waited=$((waited + 2))
    done
    echo "test-set: ui-state never matched /$want/ after ${waited}s" >&2
    return 1
}

ts_ui_path() {
    local uuid; uuid=$(ts_active_uuid)
    echo "/data/UserData/schwung/modules/tools/movy/sets/${uuid:-_default}/ui-state.json"
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
    scp -q "$TS_FIXTURE_DIR/seq-state.json" "ableton@$HOST:$p" || return 1
    # ui-state.json is a SECOND per-set file holding mute/solo, root, scale,
    # layout and per-track octave. Resetting only seq-state left a run inheriting
    # the previous one's solo state, which is exactly the cross-test
    # contamination this fixture exists to stop.
    scp -q "$TS_FIXTURE_DIR/ui-state.json" "ableton@$HOST:${p%/*}/ui-state.json" || return 1
    # The rotating shadow copies outrank a lower-generation canonical file, so a
    # stale pair would be restored right back over the fixture on the next open.
    ts_ssh "rm -f '${p%/*}/seq-state.1.json' '${p%/*}/seq-state.2.json'"
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

# Restart the Move stack so the hardware is usable again after a run.
#
# Device tests leave movy open in overtake, where it owns the LEDs and
# suppresses Move's own LED writes (the "LED ownership claimed" log line). Once
# the run ends nothing hands them back, so the pads and step buttons stay dark
# or stuck — the hardware looks broken until something restarts the stack. The
# restart also clears the wedged inject ring that occasionally floods shadow_ui
# with zero-MIDI.
#
# restart-move.sh detaches immediately, so this polls until the stack is back
# rather than guessing at a sleep. Skipped when TS_SKIP_RESTORE=1, which
# test-all-device.sh sets so a full sweep restarts once at the end instead of
# once per suite.
test_set_end() {
    [ "${TS_SKIP_RESTORE:-0}" = "1" ] && return 0
    echo "test-set: restarting the Move stack to hand the LEDs back..." >&2
    ts_ssh "/data/UserData/schwung/restart-move.sh" >/dev/null 2>&1 || true
    local waited=0
    sleep 5
    while [ $waited -lt 90 ]; do
        if ts_ssh "pidof shadow_ui >/dev/null 2>&1 && pidof MoveOriginal >/dev/null 2>&1" 2>/dev/null; then
            sleep 3          # let it finish claiming the surface
            echo "test-set: Move stack back up" >&2
            return 0
        fi
        sleep 5; waited=$((waited + 5))
    done
    echo "test-set: WARNING — Move stack did not come back within ${waited}s" >&2
    return 1
}
