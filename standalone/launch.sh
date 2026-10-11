#!/bin/sh
# Installed as <module dir>/standalone. Two doors, one body (plan WP8):
#   Tools menu  -> schwung's launch-standalone.sh -> standalone         (no argument;
#                  stdout on /dev/null, the uid that owned the stack; Move comes
#                  back when this exits)
#   boot picker -> boot-entry.sh                  -> standalone --boot  (ableton;
#                  nothing comes back unless movy-host hands over, host/handover.h)
DIR="$(cd "$(dirname "$0")" && pwd)"
# One launch per file: the first thing to read when a launch misbehaves, and
# written even when debug_log_on is absent. Replaced, never reopened: a root
# run (the dev stack) leaves it root-owned, and a failed redirect would end
# this script before movy-host ever started. The directory is ableton's, so
# the unlink works for either uid.
LOG=/data/UserData/schwung/movy-host.log
rm -f "$LOG" 2>/dev/null
if ! : 2>/dev/null >"$LOG"; then LOG=/dev/null; fi
exec >"$LOG" 2>&1

# WHICH DOOR: an argument, never an environment variable. An exported one
# survives the boot exit's exec into Schwung, and that session's next Tools
# launch would take the boot branches (dbx, 2026-09-12: a split device).
DOOR=tools
case "${1:-}" in
    --boot) DOOR=boot ;;
    "")     ;;
    *)      echo "launch: unknown argument $1 (expected --boot or nothing)"; exit 2 ;;
esac
echo "launch: door=$DOOR uid=$(id -u)"

# Re-bless the RT helper whenever it is missing, not root 04755, or not the
# one this install ships (dbx: a reinstall can un-setuid it, and chown -R
# would clear the bit). schwung-heal installs bin/heal.new as root 04755.
HEAL=/data/UserData/schwung/bin/schwung-heal
# bin/ must stay ableton's: schwung-heal reads the stage from it, and a root
# run (the dev stack) that created it root-owned locked every later ableton
# launch out of re-staging (measured). Only bin/heal itself is root's.
mkdir -p "$DIR/bin"
[ "$(id -u)" = 0 ] && chown ableton:users "$DIR/bin"
if [ -f "$DIR/movy-heal" ]; then
    if [ ! -u "$DIR/bin/heal" ] || [ "$(stat -c %u "$DIR/bin/heal" 2>/dev/null)" != 0 ] \
            || ! cmp -s "$DIR/movy-heal" "$DIR/bin/heal"; then
        if ! cp "$DIR/movy-heal" "$DIR/bin/heal.new"; then
            echo "launch: cannot stage bin/heal.new; RT will be DEGRADED until a root launch fixes bin/"
        elif [ -u "$HEAL" ]; then "$HEAL"
        else echo "launch: $HEAL is not setuid; RT will be DEGRADED"; fi
    fi
fi

# The boot selector starts nothing for its targets (schwung docs/BOOT_TARGETS.md),
# and the Tools door's launch-standalone.sh leaves both running, so this is a
# no-op there. The module store (updates) and the screen mirror need them.
# Checked by cmdline, as schwung-entry.sh does: a pid file outlives a reboot and
# its number comes back as something else.
running() { for p in $(pidof "$1" 2>/dev/null); do grep -q "$1" "/proc/$p/cmdline" 2>/dev/null && return 0; done; return 1; }
SCHWUNG=/data/UserData/schwung
if [ -x "$SCHWUNG/schwung-manager" ] && ! running schwung-manager; then
    "$SCHWUNG/schwung-manager" -port 7700 -roots /data/UserData/ >>"$SCHWUNG/schwung-manager.log" 2>&1 &
    echo $! >"$SCHWUNG/schwung-manager.pid"
    echo "launch: started schwung-manager ($!)"
fi
if [ -x "$SCHWUNG/display-server" ] && ! running display-server; then
    "$SCHWUNG/display-server" >/dev/null 2>&1 &
    echo "launch: started display-server ($!)"
fi

# The boot door EXECs: this pid is the one MoveLauncher supervises, so it must
# stay ours and must never just exit — movy-host hands it to Schwung on a quit
# (and on a crash) and exits only on a stop. It is also the pid a stop's TERM
# reaches, which movy-host can unblock and this shell cannot (MoveLauncher's
# mask blocks it, host/signals.h). No sweep, no launcher pause: at boot there
# is no Move to stop, and MoveLauncher is our own supervisor.
if [ "$DOOR" = boot ]; then
    [ -x "$DIR/movy-host" ] && exec "$DIR/movy-host" --boot
    # A failed exec ends this shell, so each line here only runs for a MISSING
    # file: the device still boots, into Schwung or stock Move.
    echo "launch: no movy-host at $DIR; handing the device to Schwung"
    [ -x "$SCHWUNG/schwung-entry.sh" ] && exec "$SCHWUNG/schwung-entry.sh"
    exec /opt/move/MoveOriginal
fi

# Harness mode only: a clean close does not go back to Move. It HOLDS instead, with SPI free and Move still down, until the
# harness writes "go" (open again: ~0.5 s) or "quit" (back to Move) into
# $CMD. Every close/open pair otherwise costs a Move restart and a kill sweep
# (WP7 T1: reselect 280 s against ~70 s on overtake). Bounded, so a harness
# that died mid-run still gives the device back. A lock loser (rc 1) and a
# floor refusal (rc 2) never hold: neither is a session of ours.
# Not /dev/shm/movy-*: movy-host sweeps that prefix as stale at start.
# The test bus flag lives in /dev/shm, never in the module dir: there it
# outlived the run that made it, so a user's next launch held after "Close
# Movy" (dark screen, LEDs on, no Move for 5 min) and the power button dry-ran.
# A reboot now clears it, and the harness removes it when it is done.
SHM=${MOVY_SHM:-/dev/shm}   # overridable for selftest/standalone-hold.mjs
PIDF=$SHM/.movy-launcher HOLD=$SHM/.movy-hold CMD=$SHM/.movy-cmd
TESTBUS=$SHM/.movy-testbus
HOLD_S=${MOVY_HOLD_S:-300}
if [ ! -e "$TESTBUS" ]; then exec "$DIR/movy-host"; fi
# ableton's whatever uid we run as: /dev/shm is sticky, and a root-owned file
# there could not be removed by a later ableton launcher (a stale "go").
own() { chmod 666 "$1" 2>/dev/null; [ "$(id -u)" = 0 ] && chown ableton:users "$1"; }
rm -f "$HOLD" "$CMD"
echo $$ >"$PIDF"; own "$PIDF"
while :; do
    "$DIR/movy-host"
    rc=$?
    echo "launch: movy-host exited $rc"
    { [ $rc = 0 ] || [ $rc = 3 ]; } && [ -e "$TESTBUS" ] || break
    : >"$HOLD"; own "$HOLD"
    n=0 cmd=
    while [ $n -lt $((HOLD_S * 20)) ]; do
        cmd=$(cat "$CMD" 2>/dev/null)
        [ -n "$cmd" ] && break
        sleep 0.05; n=$((n + 1))
    done
    rm -f "$HOLD" "$CMD"
    echo "launch: hold ended (${cmd:-timeout}) after $((n * 50)) ms"
    [ "$cmd" = go ] || break
done
rm -f "$PIDF" "$HOLD"
exit $rc
