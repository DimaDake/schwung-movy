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
restart_move_stack() {
    local host="$1" while_down="${2:-}"
    ssh -o ConnectTimeout=5 "root@$host" "python3 -c \"
import os, subprocess, sys, time
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
if pids('MoveOriginal') == old and old:
    print('restart: THE STACK NEVER WENT DOWN — MoveOriginal is still pid %s.' % ','.join(old))
    print('restart: a redeployed dsp.so is NOT running. Re-run as root.')
    sys.exit(1)
cmd = '''$while_down'''
if cmd.strip(): os.system(cmd)
while time.time() - t0 < 120:
    new = pids('MoveOriginal')
    if new and new != old and pids('shadow_ui'): break
    time.sleep(0.1)
if not (pids('MoveOriginal') and pids('shadow_ui')):
    print('restart: the stack went down but did not come back')
    sys.exit(1)
print('restart: down at %.1fs, new stack at %.1fs' % (down, time.time() - t0))
\""
}
