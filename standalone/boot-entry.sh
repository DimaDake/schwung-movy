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
# Never strand the device: no launcher still boots stock Move.
[ -x "$LAUNCHER" ] || exec /opt/move/MoveOriginal
# An argument, not an exported variable: see `standalone`.
exec "$LAUNCHER" --boot
