#!/bin/sh
# Boot-target entry (schwung docs/BOOT_TARGETS.md). module.json's boot_target
# points `exec` here; the manager registers the picker row on install/update.
#
# THE SECOND DOOR. It runs the SAME `standalone` the Tools menu runs, with
# --boot, so the two doors cannot drift. Unlike schwung's recipe it EXECs
# rather than wrapping the binary: the pid MoveLauncher supervises must be
# movy-host itself, the only process that can unblock a stop's TERM; movy-host
# does the recipe's hand-over to Schwung on a quit (host/handover.h).
LAUNCHER="$(cd "$(dirname "$0")" && pwd)/standalone"
# Overridable so host/tests/test_boot_door.sh can run this off the device.
SCHWUNG_ENTRY="${SCHWUNG_ENTRY:-/data/UserData/schwung/schwung-entry.sh}"
# The return from a Tools session (see `standalone`): this selector run is
# launch-standalone.sh restarting Move, not a boot, so go back to Schwung.
# One-shot: the next real boot is movy's again.
RETURN="${MOVY_SHM:-/dev/shm}/.movy-return"
if [ -e "$RETURN" ]; then
    rm -f "$RETURN"
    [ -x "$SCHWUNG_ENTRY" ] && exec "$SCHWUNG_ENTRY"
    exec /opt/move/MoveOriginal
fi
# Never strand the device: no launcher still boots stock Move.
[ -x "$LAUNCHER" ] || exec /opt/move/MoveOriginal
# An argument, not an exported variable: see `standalone`.
exec "$LAUNCHER" --boot
