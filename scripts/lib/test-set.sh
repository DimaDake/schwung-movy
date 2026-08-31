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

# Which host owns tracks 1-4 for this run: `schwung` (Move's four shadow slots,
# the stock arrangement) or `movy` (movy's own chains 0-3, the `chtracks`
# feature). Every suite runs on both — scripts/test-all-device-schwung.sh and
# scripts/test-all-device-movy.sh are the two sweeps.
#
# The fixture seeds BOTH hosts in either mode: `slots.txt` for schwung's slots
# and the `chains` array in `ui-state.json` for movy's. Only one of them is live
# at a time, because `chainSetTriples` drops every track under `HOST_TRACKS`
# when the flag says schwung — so the inactive half is inert rather than
# conflicting, and switching modes costs no reload.
TS_HOST_MODE="${TS_HOST_MODE:-schwung}"
case "$TS_HOST_MODE" in
    schwung|movy) ;;
    *) echo "test-set: TS_HOST_MODE must be 'schwung' or 'movy', not '$TS_HOST_MODE'" >&2
       return 1 2>/dev/null || exit 1 ;;
esac

TS_PREFS=/data/UserData/schwung/modules/tools/movy/prefs.json

# Read from the source so the harness cannot drift from the build: a prefs.json
# whose `flagsRev` is below a flag's `revisedAt` has its stored value ignored
# once (flags.ts), which would silently undo the host we just pinned.
TS_FLAGS_REV=$(grep -oE 'FLAGS_REV = [0-9]+' "$MOVY_DIR/src/seq/flags-def.ts" \
               | grep -oE '[0-9]+$')

ts_ssh() { ssh "ableton@$HOST" "$@"; }

# shellcheck source=restart-stack.sh
. "$(dirname "${BASH_SOURCE[0]}")/restart-stack.sh"

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
    # One implementation, in lib/restart-stack.sh — and it runs as root, which
    # is the only way restart-move.sh does anything (MoveOriginal is root's).
    # It reports failure when the stack never went down instead of printing a
    # 60-second wait as though it had.
    restart_move_stack "$HOST" "$while_down"
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
    # Delete before writing. Movy's own saves go through the host, which runs as
    # ROOT (MoveOriginal's), so a set movy has saved since the last fixture
    # install holds root-owned 644 files — and scp opens the destination for
    # writing, so it is refused however writable the directory is. The directory
    # is ableton's, so unlinking is allowed and the fresh file is ours again.
    # Until this existed, one movy save turned every remaining suite in a sweep
    # into "could not establish the fixture state".
    ts_ssh "mkdir -p \"\$(dirname '$p')\" && rm -f '$p' '${p%/*}/ui-state.json'" || return 1
    scp -q "$TS_FIXTURE_DIR/seq-state.json" "ableton@$HOST:$p" || return 1
    # ui-state.json is a SECOND per-set file holding mute/solo, root, scale,
    # layout, per-track octave and the movy-hosted chains. Resetting only
    # seq-state left a run inheriting the previous one's solo state, which is
    # exactly the cross-test contamination this fixture exists to stop.
    #
    # Rendered, not copied: each chain component's preset blob is filled in from
    # the same slot_<N>.json the schwung half is restored from, so the two hosts
    # cannot drift into testing different sounds. See fixture-ui-state.mjs.
    local ui rc
    ui=$(mktemp) || return 1
    node "$MOVY_DIR/scripts/fixture-ui-state.mjs" "$TS_FIXTURE_DIR" > "$ui" \
        && scp -q "$ui" "ableton@$HOST:${p%/*}/ui-state.json"
    rc=$?
    rm -f "$ui"
    [ $rc -eq 0 ] || return 1
    # The rotating shadow copies outrank a lower-generation canonical file, so a
    # stale pair would be restored right back over the fixture on the next open.
    ts_ssh "rm -f '${p%/*}/seq-state.1.json' '${p%/*}/seq-state.2.json'"
}

# Pin which host owns tracks 1-4, in prefs.json, for the whole run.
#
# The GLOBAL flag, deliberately, not the set's `chtrackset`: `resolveHost` reads
# the per-set half only in NEW SETS mode, so writing 0 or 1 here makes the run's
# host independent of which Move set is active and what that set happens to
# carry. Move's firmware owns set switching, so the harness cannot pick the set
# — leaving the host to it would make the mode a coin flip.
#
# `flags.ts` caches prefs for the life of one movy open, so this only takes
# effect on the NEXT open; every caller writes it with movy closed.

# What prefs.json held before this process pinned anything, as `<chtracks>
# <flagsRev>`. `-` means the key was ABSENT, which is not the same as 0: absent
# takes the shipped default (NEW SETS), so writing 0 back would leave the user
# on a setting they never chose. Empty means nothing has been saved yet.
TS_HOST_FLAG_SAVED=""

ts_save_host_flag() {
    [ -n "$TS_HOST_FLAG_SAVED" ] && return 0
    TS_HOST_FLAG_SAVED=$(ts_ssh "python3 -c \"
import json
try:
    o = json.load(open('$TS_PREFS'))
except Exception:
    o = {}
f = o.get('flags') if isinstance(o, dict) else None
if not isinstance(f, dict):
    f = {}
print('%s %s' % (f.get('chtracks', '-'), (o.get('flagsRev', '-') if isinstance(o, dict) else '-')))
\"" 2>/dev/null | tr -d '\r\n')
    [ -n "$TS_HOST_FLAG_SAVED" ] || TS_HOST_FLAG_SAVED="- -"
}

# Put the user's own track-host setting back. The harness pins the flag for the
# length of a run; leaving it pinned would silently move which host owns tracks
# 1-4 on the device afterwards, which is a real setting and not the harness's to
# change.
ts_restore_host_flag() {
    [ -n "$TS_HOST_FLAG_SAVED" ] || return 0
    local v r
    read -r v r <<EOF
$TS_HOST_FLAG_SAVED
EOF
    TS_HOST_FLAG_SAVED=""
    ts_ssh "python3 -c \"
import json, os
p = '$TS_PREFS'
try:
    o = json.load(open(p))
except Exception:
    o = {}
if not isinstance(o, dict):
    o = {}
f = o.get('flags')
if not isinstance(f, dict):
    f = {}
if '$v' == '-':
    f.pop('chtracks', None)
else:
    f['chtracks'] = int('$v')
o['flags'] = f
if '$r' == '-':
    o.pop('flagsRev', None)
else:
    o['flagsRev'] = int('$r')
open(p + '.ts-tmp', 'w').write(json.dumps(o))
os.rename(p + '.ts-tmp', p)
\"" >/dev/null 2>&1
}

ts_apply_host_flag() {
    local want=0 got
    ts_save_host_flag
    [ "$TS_HOST_MODE" = "movy" ] && want=1
    got=$(ts_ssh "python3 -c \"
import json, os
p = '$TS_PREFS'
try:
    o = json.load(open(p))
except Exception:
    o = {}
if not isinstance(o, dict):
    o = {}
f = o.get('flags')
if not isinstance(f, dict):
    f = {}
f['chtracks'] = $want
o['flags'] = f
try:
    rev = int(o.get('flagsRev') or 0)
except Exception:
    rev = 0
o['flagsRev'] = max(rev, $TS_FLAGS_REV)
open(p + '.ts-tmp', 'w').write(json.dumps(o))
os.rename(p + '.ts-tmp', p)
print(json.load(open(p))['flags']['chtracks'])
\"" 2>/dev/null | tr -d '\r\n')
    [ "$got" = "$want" ] && return 0
    echo "test-set: prefs.json chtracks reads '${got:-<no answer>}', wanted $want" >&2
    return 1
}

# The movy-hosted half of the fixture: `<track> <component> <module>` per line,
# read out of the same `ui-state.json` movy itself restores from. One parser, so
# what is installed and what is verified cannot disagree — the same rule
# `ts_fixture_entries` follows for schwung's slots.
ts_chain_entries() {
    node -e "
const o = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
for (const t of o.chains || [])
    for (const c of t.comp || []) console.log(t.t + ' ' + c.c + ' ' + c.m);
" "$TS_FIXTURE_DIR/ui-state.json" 2>/dev/null
}

# Which host owns a track right now. Tracks 5-16 are always movy's; 1-4 follow
# the run's mode.
ts_track_host() {
    if [ "$1" -ge 4 ] || [ "$TS_HOST_MODE" = "movy" ]; then echo movy; else echo schwung; fi
}

# Ask the engine what each movy chain HOLDS, and print the answer line.
#
# Waits for the poke's OWN line rather than reading whatever the log already
# holds: `chloadedlog` is write-to-read, so the reply lands a moment later and
# the previous one describes a chain from before whatever the caller just did.
ts_chloaded() {
    local before after waited=0
    before=$(ts_ssh "grep -c 'chain loaded:' /data/UserData/schwung/debug.log 2>/dev/null || echo 0" | tr -d '\r\n')
    HOST="$HOST" node "$MOVY_DIR/scripts/engine-param.mjs" \
        set chloadedlog 1 "$HOST" </dev/null >/dev/null 2>&1
    while [ $waited -lt 10 ]; do
        after=$(ts_ssh "grep 'chain loaded:' /data/UserData/schwung/debug.log 2>/dev/null || true")
        if [ "$(echo "$after" | grep -c 'chain loaded:')" -gt "${before:-0}" ]; then
            echo "$after" | tail -1
            return 0
        fi
        sleep 1; waited=$((waited + 1))
    done
    return 1
}

# What a track's chain component currently holds, or "" when it is empty.
#
# Two hosts, two transports — a schwung slot answers on the remote-UI socket,
# a movy chain only through the engine's log (there is no get verb). The movy
# side therefore needs movy OPEN: the overtake DSP is unloaded on exit, so a
# read taken with movy closed is not "empty", it is nobody listening.
ts_read_component() {
    local track="$1" component="$2" tok
    if [ "$(ts_track_host "$track")" = "movy" ]; then
        tok=$(ts_chloaded | grep -oE "(^| )$track:$component=[^ ]*" | tail -1)
        # A trailing `?` is a module the engine was ASKED for and never
        # instantiated. Handing that back as "what was there" would make the
        # restore re-request a load that has already failed once.
        case "$tok" in *\?) return 0 ;; esac
        echo "$tok" | sed 's/^ *//' | cut -d= -f2
    else
        node "$MOVY_DIR/scripts/module-slot.mjs" get "$track" "$component" </dev/null 2>/dev/null
    fi
}

# Load a module into a track's chain component on whichever host owns the track;
# `none` empties it.
#
# A suite that borrows a slot must come through here. Writing to schwung's slot
# 0 while tracks 1-4 are movy chains loads the module into a host the track is
# not on — the module loads, the read-back confirms it, and every assertion
# afterwards runs against a chain that is still empty.
ts_load_component() {
    local track="$1" component="$2" module="$3"
    if [ "$(ts_track_host "$track")" = "movy" ]; then
        [ "$module" = "none" ] && module=""
        HOST="$HOST" node "$MOVY_DIR/scripts/engine-param.mjs" \
            set "ch$track:$component:module" "$module" "$HOST" </dev/null >/dev/null 2>&1
    else
        node "$MOVY_DIR/scripts/module-slot.mjs" set "$track" "$component" "$module" \
            </dev/null >/dev/null 2>&1
    fi
}

# The synth the fixture puts on a track, under whichever host owns it.
#
# A suite that asserts on the instrument must ask for it rather than writing
# `plaits` down: the two hosts are seeded from different files, and a hard-coded
# id is how an assertion silently stops describing the fixture it runs against.
ts_fixture_synth() {
    local track="$1"
    if [ "$TS_HOST_MODE" = "movy" ]; then
        ts_chain_entries | awk -v t="$track" '$1 == t && $2 == "synth" { print $3; exit }'
    else
        ts_fixture_entries | awk -v t="$track" '$1 == t && $2 != "none" { print $2; exit }'
    fi
}

# Confirm the movy-hosted chains actually hold the fixture's modules. No-op in
# schwung mode, where `ts_verify` is the equivalent check.
#
# The read-back is the engine's `chloadedlog` diagnostic: the remote-UI socket
# can WRITE an engine param but has no get verb, so the engine is poked and
# answers in the log with what each chain HOLDS (`loaded_report`, read off the
# live instance). The per-load line is not a substitute — a chain already at the
# right module is deliberately left alone, so a second run against the same
# fixture would see no load at all and read as a failure.
#
# movy has to be open for any of it: the set restore is what issues the loads,
# and the overtake DSP is unloaded on exit. It is closed again afterwards
# because every suite expects to do the FIRST open itself — several assert on
# lines only a fresh open writes.
ts_verify_chains() {
    [ "$TS_HOST_MODE" = "movy" ] || return 0
    local want; want=$(ts_chain_entries)
    [ -n "$want" ] || return 0

    # Cleared, not merely enabled: a matching line left by the PREVIOUS run
    # would let this pass without the chains having loaded at all.
    ts_ssh "touch /data/UserData/schwung/debug_log_on
            > /data/UserData/schwung/debug.log" || return 1
    ts_open_movy
    # Wall clock, not a count of sleeps: each pass costs several ssh round trips
    # and a `chloadedlog` poll, so counting only the sleeps turned a 40 s budget
    # into minutes on the one path that always spends the whole thing — a
    # fixture that is not going to load.
    local deadline=$(( $(date +%s) + 40 )) report missing t c m
    while [ "$(date +%s)" -lt $deadline ]; do
        sleep 2
        # The flag reached the ENGINE too, not just the UI. `drain_out` is the
        # one place that decides whether a sequenced note goes out as MIDI or
        # into a chain, so a UI-only flip leaves every note going to schwung
        # while the chains below look perfectly loaded.
        ts_ssh "grep -F 'chain tracks:' /data/UserData/schwung/debug.log 2>/dev/null || true" \
            | qgrep -F 'chain tracks: 0-3 -> movy chains' || continue
        report=$(ts_chloaded) || continue
        missing=0
        while read -r t c m; do
            [ -z "${t:-}" ] && continue
            # No trailing `?`: that marks a component the engine was asked for
            # but never instantiated.
            echo "$report" | qgrep -E "(^| )$t:$c=$m( |$)" || missing=1
        done <<EOF
$want
EOF
        if [ $missing -eq 0 ]; then
            ts_close_movy || true
            return 0
        fi
    done
    echo "test-set: movy chains never reached the fixture" >&2
    echo "  wanted: $(echo "$want" | awk '{printf "%s:%s=%s ", $1, $2, $3}')" >&2
    echo "  engine: ${report:-<no chloadedlog answer>}" >&2
    ts_close_movy || true
    return 1
}

# Everything movy itself reads, installed in the one order that works: movy has
# to be CLOSED first, because prefs are cached for the life of one open and the
# per-set blobs are autosaved over within seconds of it running.
ts_install_movy_state() {
    ts_close_movy || return 1
    ts_apply_host_flag || { echo "test-set: could not pin the track host" >&2; return 1; }
    ts_seq_apply || { echo "test-set: could not install the fixture sequencer state" >&2; return 1; }
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
    printf '\033[2m  [fixture] tracks 1-4 host: %s\033[0m\n' "$TS_HOST_MODE" >&2
    ts_phase_start "fixture: check chain"
    if ts_verify 2>/dev/null; then
        ts_phase_end
        ts_phase_start "fixture: refresh movy state"
        ts_install_movy_state || return 1
        ts_phase_end
        ts_phase_start "fixture: verify movy chains"
        ts_verify_chains || return 1
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
    ts_install_movy_state || return 1
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
            ts_phase_start "fixture: verify movy chains"
            ts_verify_chains || return 1
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
    # Before the hardware handoff, and unconditional: the flag is a real user
    # setting, and a sweep that left it pinned would move which host owns tracks
    # 1-4 for good. In a sweep this is a no-op here (TS_SKIP_RESTORE returns
    # above) and the runner does it once, from the value it saved before the
    # first suite pinned anything.
    ts_restore_host_flag
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
