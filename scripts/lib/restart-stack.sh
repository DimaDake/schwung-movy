#!/usr/bin/env bash
# restart-stack.sh — the one way to make the Move stack reload a tool from disk.
#
# **Why a restart is not optional.** The shim dlopens a tool's `dsp.so` BY PATH,
# and glibc hands back the library already loaded under that path for the whole
# life of MoveOriginal. Deploying to a fresh inode is what keeps a mapped .so
# from being corrupted (deploy.sh) — it is not what makes the new engine run.
# Movy's ENGINE_VERSION gate cannot cover this either: it re-issues the load,
# the shim answers with the same old library, and the UI simply loops. Measured
# 2026-08-29: two builds an hour apart, the newer one on disk and verified by
# md5, and the engine kept reporting the older one until MoveOriginal was gone.
#
# **Why root.** MoveOriginal runs as root, so `restart-move.sh` only does
# anything when run as root; as the ableton user its pkill silently matches
# nothing, the script still exits 0, and the stack stays up. That silence is
# what let a stale engine survive two "successful" restarts — so this reports
# failure when the old process is still there, rather than a duration.

# restart_move_stack <host> [cmd-to-run-while-down]
# Non-zero unless MoveOriginal actually went away and a NEW one came back.
#
# The body lives in restart-stack.py so the bash tier and the TS device tier
# (test-device/engine.ts) run the SAME verified restart rather than two copies
# of it.
restart_move_stack() {
    local host="$1" while_down="${2:-}"
    local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    ssh -o ConnectTimeout=5 "root@$host" python3 - "$while_down" < "$here/restart-stack.py"
}
