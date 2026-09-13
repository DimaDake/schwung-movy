# restart-stack.py — the one verified way to make the Move stack reload a tool
# from disk. Run ON THE DEVICE, AS ROOT:
#
#   ssh root@<host> python3 - [cmd-to-run-while-down] < scripts/lib/restart-stack.py
#
# Both callers share this file so the two can never drift: scripts/lib/
# restart-stack.sh (the bash tier) and test-device/engine.ts (the TS tier).
# See restart-stack.sh for WHY a restart is not optional and why it must be
# root — measured, both of them.
#
# Exits non-zero unless MoveOriginal actually went away and a NEW one came back.
# That is the whole point: as the `ableton` user the kill inside
# restart-move.sh is EPERM, swallowed by `|| true`, and the script still exits
# 0 with the old engine running. Verified again 2026-09-12 — MoveOriginal kept
# pid 7515 across a "successful" restart.
import os, subprocess, sys, time


def pids(name):
    try:
        return subprocess.check_output(['pidof', name]).decode().split()
    except Exception:
        return []


old = pids('MoveOriginal')
subprocess.call(['/data/UserData/schwung/restart-move.sh'])

t0 = time.time()
while time.time() - t0 < 60:
    if not pids('MoveOriginal'):
        break
    time.sleep(0.02)
down = time.time() - t0

if pids('MoveOriginal') == old and old:
    print('restart: THE STACK NEVER WENT DOWN — MoveOriginal is still pid %s.' % ','.join(old))
    print('restart: a redeployed dsp.so is NOT running. Re-run as root.')
    sys.exit(1)

cmd = sys.argv[1] if len(sys.argv) > 1 else ''
if cmd.strip():
    os.system(cmd)

while time.time() - t0 < 120:
    new = pids('MoveOriginal')
    if new and new != old and pids('shadow_ui'):
        break
    time.sleep(0.1)

if not (pids('MoveOriginal') and pids('shadow_ui')):
    print('restart: the stack went down but did not come back')
    sys.exit(1)

print('restart: down at %.1fs, new stack at %.1fs' % (down, time.time() - t0))
