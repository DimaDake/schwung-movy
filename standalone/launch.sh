#!/bin/sh
# Installed as <module dir>/standalone. schwung's launch-standalone.sh runs it
# with no arguments and stdout on /dev/null, as the uid that owned the stack.
DIR="$(cd "$(dirname "$0")" && pwd)"
# One launch per file: the first thing to read when a launch misbehaves, and
# written even when debug_log_on is absent. Replaced, never reopened: a root
# run (the dev stack) leaves it root-owned, and a failed redirect would end
# this script before movy-host ever started. The directory is ableton's, so
# the unlink works for either uid.
LOG=/data/UserData/schwung/movy-host.log
rm -f "$LOG" 2>/dev/null
if ! : >"$LOG" 2>/dev/null; then LOG=/dev/null; fi
exec >"$LOG" 2>&1

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

# Harness mode only (the test bus file never ships): a clean close does not go
# back to Move. It HOLDS instead, with SPI free and Move still down, until the
# harness writes "go" (open again: ~0.5 s) or "quit" (back to Move) into
# $CMD. Every close/open pair otherwise costs a Move restart and a kill sweep
# (WP7 T1: reselect 280 s against ~70 s on overtake). Bounded, so a harness
# that died mid-run still gives the device back. A lock loser (rc 1) and a
# floor refusal (rc 2) never hold: neither is a session of ours.
# Not /dev/shm/movy-*: movy-host sweeps that prefix as stale at start.
SHM=${MOVY_SA_SHM:-/dev/shm}   # overridable for selftest/standalone-hold.mjs
PIDF=$SHM/.movy-sa-launcher HOLD=$SHM/.movy-sa-hold CMD=$SHM/.movy-sa-cmd
HOLD_S=${MOVY_SA_HOLD_S:-300}
if [ ! -e "$DIR/testbus" ]; then exec "$DIR/movy-host"; fi
# ableton's whatever uid we run as: /dev/shm is sticky, and a root-owned file
# there could not be removed by a later ableton launcher (a stale "go").
own() { chmod 666 "$1" 2>/dev/null; [ "$(id -u)" = 0 ] && chown ableton:users "$1"; }
rm -f "$HOLD" "$CMD"
echo $$ >"$PIDF"; own "$PIDF"
while :; do
    "$DIR/movy-host"
    rc=$?
    echo "launch: movy-host exited $rc"
    { [ $rc = 0 ] || [ $rc = 3 ]; } && [ -e "$DIR/testbus" ] || break
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
