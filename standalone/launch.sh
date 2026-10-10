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
exec "$DIR/movy-host"
