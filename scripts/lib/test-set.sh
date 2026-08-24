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

# Drop-in for `grep -q`, same arguments, in a pipeline.
#
# `grep -q` exits at its first match, which hands the writer EPIPE; under
# `set -o pipefail` the pipeline then reports 141 and a *found* line reads as a
# failed check. It only bites once the piped log outgrows the pipe buffer, so it
# arrives late and looks like a device fault: a 96 KB debug.log made test-seq.sh
# report five missing lines that were all present, several times over. Without
# -q grep reads to EOF, so the writer always finishes and the status is grep's.
qgrep() { grep "$@" >/dev/null; }

# Phase timing. Device work is slow enough that a silent 60 s stretch looks like
# a hang; naming each phase and printing its cost makes it obvious which step is
# expensive and whether it is getting worse.
ts_phase_start() { TS_PHASE_NAME="$1"; TS_PHASE_T0=$(date +%s); printf '\033[2m  [%s] ...\033[0m\n' "$1" >&2; }
ts_phase_end() {
    local dt=$(( $(date +%s) - ${TS_PHASE_T0:-0} ))
    printf '\033[2m  [%s] %ss\033[0m\n' "${TS_PHASE_NAME:-phase}" "$dt" >&2
}

# Restart the Move stack and block until a genuinely NEW one is up.
#
# `pidof shadow_ui && pidof MoveOriginal` is not a test that the restart
# happened: restart-move.sh detaches and sleeps a second before it kills
# anything, so for the first seconds those pids are the OLD stack's and the wait
# returns immediately. Everything downstream then runs against a process that is
# about to die — or, worse, reads a log the boot has not written yet and calls
# the missing line a device fault. Comparing pids is what makes it a restart.
#
# $1 (optional): a shell command run ON THE DEVICE in the window where the old
# stack is gone and the new one has not started. That window is the only place a
# per-set state file can be seeded: the controlled exit rewrites those files from
# schwung's mirror on the way out, and the fresh shim reads them back about four
# seconds later (master FX, chain slots). The window is a fraction of a second
# wide, so the poll and the write have to happen in one device-side script —
# over ssh the round trip alone outlasts it.
ts_restart_stack() {
    local while_down="${1:-}"
    ts_ssh "python3 -c \"
import os, subprocess, time
def pids(name):
    try: return subprocess.check_output(['pidof', name]).decode().split()
    except Exception: return []
old = pids('MoveOriginal')
subprocess.call(['/data/UserData/schwung/restart-move.sh'])
t0 = time.time()
while time.time() - t0 < 60:
    if not pids('MoveOriginal'): break
    time.sleep(0.02)
down = time.time() - t0
cmd = '''$while_down'''
if cmd.strip(): os.system(cmd)
while time.time() - t0 < 120:
    new = pids('MoveOriginal')
    if new and new != old and pids('shadow_ui'): break
    time.sleep(0.1)
print('restart: down at %.1fs, new stack at %.1fs' % (down, time.time() - t0))
\""
}

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

# True when every chain slot reads empty while the fixture wants a module in at
# least one — the single state no number of applies can leave (see
# ts_seed_boot_state). A device that does not answer is NOT cold: silence is
# unknown, and seeding on it would restart the stack for nothing.
ts_chain_is_cold() {
    local got
    ts_fixture_entries | qgrep -vE '[[:space:]]none$' || return 1
    got=$(node "$MOVY_DIR/scripts/slots-read.mjs" </dev/null 2>/dev/null) || return 1
    [ -n "$got" ] || return 1
    echo "$got" | qgrep -vE '[[:space:]]-$' && return 1
    return 0
}

# Seed the shim's BOOT path with the fixture, then restart the stack.
#
# The remote-UI route ts_apply uses cannot load the FIRST module into a slot. A
# web set-ring write lands in the shim's shadow_direct_set_param(), which
# forwards to the chain plugin only when shadow_chain_slots[slot].active is
# already set — so `synth:module` into a slot that holds nothing is dropped with
# no error, no log line, and a cheerful success from the manager. A device
# rebooted on an unsaved set comes up exactly there (every slot_N.json in the
# active set's state dir is "{}"), and the attempts below then cost ~110 s each
# while never being able to work: 11 minutes per suite, every suite.
#
# The shim's boot has no such gate — it load_file's each slot_N.json itself and
# sets active from the result. So write the fixture where boot reads it. The
# copy goes in the restart's DOWN window because the running shim autosaves over
# that directory.
ts_seed_boot_state() {
    local uuid dir slot mod
    uuid=$(ts_active_uuid)
    dir="/data/UserData/schwung/set_state/$uuid"
    [ -n "$uuid" ] || dir="/data/UserData/schwung/slot_state"
    ts_ssh "mkdir -p /tmp/ts-seed" || return 1
    while read -r slot mod; do
        [ -z "${slot:-}" ] && continue
        if [ "$mod" = "none" ]; then
            # "{}" is what the shim itself autosaves for an empty slot.
            ts_ssh "echo '{}' > /tmp/ts-seed/slot_${slot}.json" || return 1
        else
            scp -q "$TS_FIXTURE_DIR/slot_${slot}.json" \
                   "ableton@$HOST:/tmp/ts-seed/slot_${slot}.json" || return 1
        fi
    done < <(ts_fixture_entries)
    ts_restart_stack "mkdir -p $dir && cp /tmp/ts-seed/slot_*.json $dir/" >/dev/null || return 1
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
#
# One WebSocket for all four slots (slots-read.mjs). Reading them one at a time
# meant four connections per pass and two passes per attempt, which is what made
# establishing the fixture the most expensive thing a device test did.
ts_verify() {
    local want got
    want=$(ts_fixture_entries | awk '{printf "%s %s\n", $1, ($2=="none" ? "-" : $2)}' | sort)
    got=$(node "$MOVY_DIR/scripts/slots-read.mjs" </dev/null 2>/dev/null | sort)
    if [ -z "$got" ]; then
        echo "test-set: no answer reading the chain" >&2
        return 1
    fi
    if [ "$want" != "$got" ]; then
        echo "test-set: chain is [$(echo "$got" | tr '\n' ' ')], fixture wants [$(echo "$want" | tr '\n' ' ')]" >&2
        return 1
    fi
}

# Open movy (or resume it if it is parked in the background). The only
# programmatic way in: write the request file, then raise offOpenToolCmd = 56 in
# /dev/shm/schwung-control. mmap length must be 0 — the file is 64 bytes and an
# explicit size raises ValueError.
#
# The suites each carry their own copy of this snippet, from before there was a
# shared lib to put it in; new callers should use this one.
ts_open_movy() {
    ts_ssh "python3 -c \"
import mmap, json
open('/data/UserData/schwung/open_tool_cmd.json', 'w').write(
    json.dumps({'file_path': '/', 'tool_id': 'movy'}))
f = open('/dev/shm/schwung-control', 'r+b'); mm = mmap.mmap(f.fileno(), 0)
mm[56] = 1; mm.close()
\"" >/dev/null 2>&1
}

# True while an overtake tool owns the surface; false is Move's own UI.
# offOvertakeMode = 22 in /dev/shm/schwung-control (schwung-manager/shmconfig.go);
# movy reads 2 there. A parked module reads 0 like a closed one — this says who
# owns the foreground, not whether anything is still ticking.
#
# A device that does not answer counts as ACTIVE. Reading silence as "closed" is
# the same mistake as reading it as "slot empty" (see ts_read_slot): it turns an
# unreachable device into a clean bill of health for the one thing the caller
# needs to be sure of.
ts_overtake_active() {
    local v
    v=$(ts_ssh "python3 -c \"
import mmap
f = open('/dev/shm/schwung-control', 'r+b'); mm = mmap.mmap(f.fileno(), 0)
print(mm[22]); mm.close()
\"" 2>/dev/null | tr -d '\r\n')
    if [ -z "$v" ]; then
        echo "test-set: no answer reading overtake mode — assuming a tool still owns the surface" >&2
        return 0
    fi
    [ "$v" != "0" ]
}

# movy reads seq-state.json when it opens and autosaves over it every ~8 s, so
# the fixture can only be written with movy closed.
#
# Shift+Back, not Back x3. Back x3 used to walk knobs -> chain -> exit, and
# stopped exiting anything the moment movy grew the Leave-Movy modal: the second
# Back opens the menu and the third only cancels it, leaving movy running with
# the fixture write landing under a live autosave. Any fixed number of Backs has
# that parity problem, because how deep movy is when this is called is not
# something the caller knows.
#
# Shift+Back has no depth at all: schwung handles it in the host, above the
# module, for anything declaring suspend_self_managed (shadow_ui.js, "HOST:
# Shift+Back -> full exit"). It exits from the knobs page, a browser, a param
# page or the modal alike, runs the module's onUnload, and evicts anything
# parked in the background. One round trip, so Shift is genuinely still held
# when Back arrives.
#
# Then read the exit back. This function silently doing nothing for weeks is the
# reason it now proves its work: the caller's whole purpose is that movy is not
# running, and no other check downstream would notice that it still is.
ts_close_movy() {
    local try
    for try in 1 2 3; do
        ts_overtake_active || return 0
        ts_send "0x0B:0xB0:49:127:0.08" "0x0B:0xB0:51:127:0.08" \
                "0x0B:0xB0:51:0:0.08"   "0x0B:0xB0:49:0:0"
        sleep 1.2
    done
    ts_overtake_active || return 0
    echo "test-set: movy would not close — overtake still owns the surface" >&2
    return 1
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
# Put movy on track 1 (index 0).
#
# movy opens on whatever slot schwung has focused (shadow_get_ui_slot), which is
# device state no test owns — a suite that assumes track 0 silently asserts
# against a different track's lanes, mutes or params. Several did, and read as
# feature failures. CC 43 is the first track button, and on a fresh open the
# focused group is 0, so it selects track index 0.
ts_focus_track0() {
    ts_tap_cc 43
    sleep 0.5
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
        echo "$cur" | qgrep -E "$want" && return 0
        sleep 2; waited=$((waited + 2))
    done
    echo "test-set: ui-state never matched /$want/ after ${waited}s" >&2
    return 1
}

# Same condition-based wait, against the sequencer half of the per-set state —
# for assertions about what a gesture actually wrote to a clip (notes, length).
ts_wait_seq_state() {
    local want="$1" waited=0 cur
    while [ $waited -lt 30 ]; do
        cur=$(ts_ssh "cat '$(ts_seq_path)' 2>/dev/null || true")
        echo "$cur" | qgrep -E "$want" && return 0
        sleep 2; waited=$((waited + 2))
    done
    echo "test-set: seq-state never matched /$want/ after ${waited}s" >&2
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
    local ts_t0; ts_t0=$(date +%s)
    # Verify before doing anything. The chain is usually ALREADY at the fixture
    # (the previous run left it there), and re-loading modules that are already
    # loaded cost ~60 s per suite for no change. One batched read settles it in
    # ~2 s; only a genuine mismatch pays for an apply.
    ts_phase_start "fixture: check chain"
    if ts_verify 2>/dev/null; then
        ts_phase_end
        ts_phase_start "fixture: refresh movy state"
        ts_close_movy || return 1
        ts_seq_apply || { echo "test-set: could not install the fixture sequencer state" >&2; return 1; }
        ts_phase_end
        printf '\033[2m  [fixture ready] %ss total (chain already correct)\033[0m\n' "$(( $(date +%s) - ts_t0 ))" >&2
        return 0
    fi
    ts_phase_end

    ts_phase_start "fixture: ship"
    ts_push_fixture || { echo "test-set: could not ship the fixture to the device" >&2; return 1; }
    ts_phase_end
    # movy must be shut before the sequencer state is written, or it autosaves
    # its in-memory copy straight back over the fixture within a few seconds.
    ts_phase_start "fixture: close movy + write seq/ui state"
    ts_close_movy || return 1
    ts_seq_apply || { echo "test-set: could not install the fixture sequencer state" >&2; return 1; }
    ts_phase_end
    # A chain with nothing in it at all is not a slow load, it is an unreachable
    # one: ts_apply's writes are dropped by the shim until a slot is active, so
    # the attempts below would each burn ~110 s proving it. Seed the boot path
    # instead — a rebooted device on an unsaved set arrives here every time.
    if ts_chain_is_cold; then
        ts_phase_start "fixture: cold chain — seeding boot state + restart"
        ts_seed_boot_state || echo "test-set: WARNING — could not seed the boot state" >&2
        ts_phase_end
    fi
    # Six attempts, not three. A module load is a set_param into the chain
    # host's single-slot param SHM, where a write can simply be dropped rather
    # than merely being slow — so an attempt failing says nothing about the
    # next one. Three was demonstrably marginal: one suite in a sweep recovered
    # on attempt 3 while another gave up at the same boundary.
    for try in 1 2 3 4 5 6; do
        ts_phase_start "fixture: load chain modules (attempt $try)"
        ts_apply || true
        if ts_verify 2>/dev/null; then
            ts_phase_end
            printf '\033[2m  [fixture ready] %ss total\033[0m\n' "$(( $(date +%s) - ts_t0 ))" >&2
            return 0
        fi
        ts_phase_end
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
    # Closing movy is what hands the LEDs back: it owns the surface under
    # overtake and suppresses Move's own LED writes, and the framework clears
    # that suppression on overtake exit. Leaving it open is why the pads and
    # step buttons stayed dark after a run.
    #
    # A full restart-move.sh also works but costs ~10 s and perturbs the device
    # (fresh pids, /dev/shm left as-is), so it is reserved for TS_FULL_RESTART=1
    # when something is genuinely wedged.
    if [ "${TS_FULL_RESTART:-0}" = "1" ]; then
        ts_restart_stack >/dev/null 2>&1 || {
            echo "test-set: WARNING — Move stack did not come back" >&2
            return 1
        }
        sleep 3
        return 0
    fi
    # Cleanup runs from an EXIT trap, so its status becomes the suite's under
    # `set -e`. A hardware handoff that did not take is worth saying (the
    # function says it on stderr) but never worth turning a passing run red.
    ts_close_movy || true
}
