#!/usr/bin/env bash
# test-master-fx.sh — a master FX module loaded from movy SURVIVES persistence.
#
# Covers what no local suite can. Schwung saves the master chain from a JS
# mirror inside shadow_ui.js, and movy loads a master slot by writing
# `master_fx:fxN:module` straight to the shim, which that mirror never observes
# — so the save wrote "{}" over the slot and the whole master chain was gone on
# the next boot (schwung-movy#9). chain/master-mirror.ts repairs the mirror by
# reaching into shadow_ui.js's published `ctx`.
#
# Two device facts are on trial here, and neither is reachable off device:
#
#   1. movy's import of shadow_ui_ctx.mjs resolves to the SAME live module
#      instance shadow_ui.js populated (QuickJS caches modules by normalized
#      name; if that assumption is wrong the resync is a silent no-op).
#   2. the per-set state file actually keeps the module_id afterwards.
#
# The app-loop suite already asserts movy CALLS the resync; only these two need
# real hardware. Delete this file with chain/master-mirror.ts once schwung's
# saveMasterFxChainConfig reads the shim instead of its mirror.
#
# Usage: ./scripts/test-master-fx.sh [move.local]
set -u

HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
trap test_set_end EXIT INT TERM

GRN='\033[0;32m'; RED='\033[0;31m'; BLD='\033[1m'; RST='\033[0m'
fails=0
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; fails=$((fails+1)); }

LOG=/data/UserData/schwung/debug.log
CC_SESSION=50; CC_JOG_TURN=14; CC_JOG_CLICK=3

echo -e "${BLD}=== Deploying ===${RST}"
"$MOVY_DIR/scripts/deploy.sh" "$HOST" >/dev/null 2>&1 || { echo "deploy failed"; exit 1; }

UUID="$(ts_active_uuid)"
[ -n "$UUID" ] || { echo "no active set uuid"; exit 1; }
STATE="/data/UserData/schwung/set_state/$UUID/master_fx_0.json"
echo "active set: $UUID"

# Start from a genuinely empty slot, so a module_id found at the end can only
# have come from this run.
#
# Emptying the state file is not enough: the SHIM keeps whatever it loaded until
# the process dies, so a slot left loaded by an earlier run would let a resync
# that never works read the right answer anyway — a false pass. Only a restart
# with an empty state file guarantees the shim starts with nothing. It costs
# ~20 s, and it is the difference between this suite proving something and not.
echo -e "${BLD}=== Restarting the stack so the shim starts with no master FX ===${RST}"
ts_ssh "/data/UserData/schwung/restart-move.sh" >/dev/null 2>&1 || true
# Seed the empty file only once the stack is DOWN. Seeding it first does not
# work: the controlled exit runs shadow_save_state_now on the way out, which
# rewrites this file from the still-populated mirror and undoes the seed. The
# kill happens in the first seconds; the boot that reads this file is ~20 s away.
sleep 6
ts_ssh "echo '{}' > $STATE"
# Clear the log in the same breath, so the boot check below can only see THIS
# boot. Reading a log that still holds the previous run's reboot made the guard
# fire on history rather than on what just happened.
ts_ssh "touch /data/UserData/schwung/debug_log_on; > $LOG"
waited=0
while [ "$waited" -lt 90 ]; do
    ts_ssh "pidof shadow_ui >/dev/null 2>&1 && pidof MoveOriginal >/dev/null 2>&1" 2>/dev/null && break
    sleep 5; waited=$((waited + 5))
done
sleep 3

if ts_ssh "cat $LOG" | qgrep "MFX boot: slot 0 loaded"; then
    fail "the shim restored a master module at boot — this run cannot prove anything"
    exit 1
fi
pass "the shim booted with master slot 1 empty"

test_set_begin || { echo "could not establish the fixture state"; exit 1; }
ts_ssh "touch /data/UserData/schwung/debug_log_on; > $LOG"

echo -e "${BLD}=== Opening Movy ===${RST}"
ts_ssh 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' 2>/dev/null
sleep 3

echo -e "${BLD}=== Loading a module into master FX slot 1 ===${RST}"
# Session view is what puts the master chain on screen (masterChainActive);
# masterChainIndex starts at 0 and the slot is empty, so a jog click opens the
# browser straight onto master_fx:fx1 rather than drilling a detail.
#
# CC 50 TOGGLES Note/Session, so which view a single tap lands on depends on
# where movy already was — device state this suite does not own. Try, look at
# what actually opened, and correct, rather than assuming a starting view.
for attempt in 1 2 3; do
    ts_tap_cc $CC_SESSION
    sleep 1.0
    ts_tap_cc $CC_JOG_CLICK
    sleep 1.5
    ts_ssh "cat $LOG" | qgrep "browse: open t=[0-9]* master_fx:fx" && break
    echo "  attempt $attempt opened elsewhere; backing out and retrying"
    ts_tap_cc 51            # Back out of whichever browser opened
    sleep 0.8
done

LOGTXT=$(ts_ssh "cat $LOG")
BROWSE=$(echo "$LOGTXT" | grep -oE 'browse: open t=[0-9]+ master_fx:fx[0-9]+ n=[0-9]+' | tail -1)
if [ -n "$BROWSE" ]; then
    pass "the browser opened on a master FX slot: $BROWSE"
else
    fail "the browser never opened on a master slot — the gesture did not land"
    echo "$LOGTXT" | grep -oE 'browse: open .*' | tail -3
    echo "aborting: nothing below can be meaningful"; exit 1
fi

# Index 0 is the synthetic NONE entry, so step past it before confirming.
ts_send "0x0B:0xB0:$CC_JOG_TURN:1:0.30"
sleep 0.5
ts_tap_cc $CC_JOG_CLICK
sleep 3

LOGTXT=$(ts_ssh "cat $LOG")
if echo "$LOGTXT" | qgrep "mfx: no shadow ctx"; then
    fail "movy could not reach shadow_ui.js's ctx — the import resolved to a DIFFERENT module instance"
elif echo "$LOGTXT" | qgrep "mfx: mirror resynced"; then
    pass "movy reached the live shadow ctx and resynced the mirror"
elif echo "$LOGTXT" | qgrep "mfx: mirror resync failed"; then
    fail "the resync threw: $(echo "$LOGTXT" | grep -oE 'mfx: mirror resync failed.*' | tail -1)"
else
    fail "no mfx log line at all — the master branch never ran"
fi

MTIME_BEFORE=$(ts_ssh "stat -c %Y $STATE" 2>/dev/null | tr -d '\r\n')

echo -e "${BLD}=== Closing Movy so schwung's autosave resumes ===${RST}"
# The periodic autosave only ARMS when overtake is inactive, so the save under
# test cannot happen until movy has genuinely exited.
#
# Not ts_close_movy: tapping Back PARKS movy under Move's UI (background mode)
# rather than closing it, so overtake stays active and no save ever runs — which
# looked exactly like the bug being unfixed. This is the real Leave-Movy flow
# (Back at root → jog to "Close Movy" → confirm), the same one test-unload.sh
# drives.
ts_tap_cc 51                        # Back at root → Leave modal
sleep 0.6
ts_send "0x0B:0xB0:$CC_JOG_TURN:1:0.30"   # jog CW → highlight "Close Movy"
sleep 0.5
ts_tap_cc $CC_JOG_CLICK             # confirm
sleep 3

if ts_ssh "grep -a '\[movy\]' $LOG | tail -n 1" | qgrep "unload"; then
    pass "movy actually exited (unload fired), so autosave can arm"
else
    # Not fatal on its own, but without it the wait below is meaningless.
    echo "  ! no unload line — movy may still be parked; the save may not arm"
fi

# AUTOSAVE_INTERVAL is 300 ticks (~10 s at 30fps) and the pass is spread one
# slot per tick, with master FX last. Poll rather than sleep a guessed total:
# the tick rate varies with load, so any fixed sleep here is a race.
echo "waiting for the autosave pass..."
FOUND=""
for _ in $(seq 1 20); do
    sleep 2
    if ts_ssh "cat $STATE" | qgrep '"module_id"'; then FOUND=1; break; fi
done

CONTENT=$(ts_ssh "cat $STATE")
MTIME_AFTER=$(ts_ssh "stat -c %Y $STATE" 2>/dev/null | tr -d '\r\n')
# Whether the saver ran at all is the difference between "the mirror was cleared"
# and "the save never happened", and the file content alone cannot tell them
# apart — the empty branch rewrites byte-identical content.
echo "  state file mtime: before=$MTIME_BEFORE after=$MTIME_AFTER"
if [ -n "$FOUND" ]; then
    pass "the set state kept the module: $(echo "$CONTENT" | grep -oE '"module_id"[^,]*' | head -1)"
    if echo "$CONTENT" | grep -oE '"module_path"[^,]*' | qgrep '\.so'; then
        pass "and a real DSP path, so the shim can restore it at boot"
    else
        # An id without a path is the MASTER_FX_OPTIONS gap: the file looks
        # saved and restores nothing.
        fail "module_id saved but module_path is empty — it will not restore"
        echo "$CONTENT" | head -5
    fi
else
    fail "master_fx_0.json still has no module_id — the slot was erased (issue #9 unfixed)"
    echo "$CONTENT" | head -5
fi

# The file surviving is the movy-side contract, but what the user actually
# reported is the chain being empty after a power cycle — so finish by taking
# the state file through a real boot and asking the shim to restore it.
if [ -n "$FOUND" ]; then
    echo -e "${BLD}=== Rebooting the stack to prove it restores ===${RST}"
    ts_ssh "> $LOG"
    ts_ssh "/data/UserData/schwung/restart-move.sh" >/dev/null 2>&1 || true
    sleep 5
    waited=0
    while [ "$waited" -lt 90 ]; do
        ts_ssh "pidof shadow_ui >/dev/null 2>&1 && pidof MoveOriginal >/dev/null 2>&1" 2>/dev/null && break
        sleep 5; waited=$((waited + 5))
    done
    sleep 5
    if ts_ssh "cat $LOG" | qgrep "MFX boot: slot 0 loaded"; then
        pass "the master chain came back after a reboot: $(ts_ssh "grep -ao 'MFX boot: slot 0 loaded.*' $LOG" | head -n 1)"
    else
        fail "the state file survived but the shim did not restore it at boot"
    fi
fi

echo
if [ "$fails" -eq 0 ]; then
    echo -e "${GRN}${BLD}MASTER-FX PERSISTENCE OK${RST}"
    exit 0
else
    echo -e "${RED}${BLD}$fails MASTER-FX CHECK(S) FAILED${RST}"
    exit 1
fi
