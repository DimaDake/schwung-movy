#!/usr/bin/env bash
# check-boot-target.sh — the boot door on hardware (plan WP8), scripted.
#
#   ./scripts/check-boot-target.sh [host]      (default move.local; REBOOTS it)
#
# 1. makes movy the boot default and reboots      → movy-host runs, door=boot,
#                                                   as ableton, under MoveLauncher
# 2. /etc/init.d/move stop                         → movy-host exits on the TERM
#                                                   MoveLauncher's mask blocks
#                                                   (rc 5), and Schwung does NOT start
# 3. /etc/init.d/move start                        → movy again, from the default
# 4. EXIT over the test bus (a user's Close Movy)  → Schwung comes up in the same
#                                                   pid tree (handover, not a crash)
# Always: the default goes back to what it was, and the bus flag is removed.
#
# What it cannot do: press Back in the selector's 2 s window (the picker runs
# before anything that reads an inject ring). That one is a person's check.
set -uo pipefail
HOST="${1:-move.local}"
SSH_OPTS=(-o ConnectTimeout=5 -o BatchMode=yes -o LogLevel=ERROR)
BT=/data/UserData/boot-targets
r()  { ssh "${SSH_OPTS[@]}" "root@$HOST" "$@"; }
fails=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=1; }
# Polls a remote condition (as root) for up to $1 seconds.
until_true() {
    local secs="$1" cond="$2" i=0
    while [ "$i" -lt "$secs" ]; do r "$cond" >/dev/null 2>&1 && return 0; sleep 1; i=$((i + 1)); done
    return 1
}
# BusyBox nc has no timeout flag; python3 is on the device.
bus() { r "python3 -c \"import socket;s=socket.create_connection(('127.0.0.1',47777),3);s.settimeout(3);s.sendall(b'$1\\n');print(s.recv(200).decode())\""; }
wait_ssh() {
    local i=0
    while [ "$i" -lt 180 ]; do r true 2>/dev/null && return 0; sleep 2; i=$((i + 2)); done
    return 1
}

OLD_DEFAULT=$(r "cat $BT/default 2>/dev/null" || echo schwung)
[ -n "$OLD_DEFAULT" ] || OLD_DEFAULT=schwung
restore() {
    r "printf '%s\n' '$OLD_DEFAULT' > $BT/default; chown ableton:users $BT/default; rm -f /dev/shm/.movy-testbus" \
        && echo "boot default restored to '$OLD_DEFAULT'"
}
trap restore EXIT

r "test -f $BT/movy/boot.json" || { echo "no $BT/movy/boot.json — deploy movy first (scripts/deploy.sh)"; exit 2; }
r "printf 'movy\n' > $BT/default; chown ableton:users $BT/default"
echo "rebooting $HOST into movy…"
r "reboot" || true
sleep 15
wait_ssh || { bad "the device did not come back over ssh"; exit 1; }

echo "1. boot → movy"
if until_true 60 'pidof movy-host'; then ok "movy-host runs after boot"; else bad "no movy-host after boot"; fi
P=$(r 'pidof movy-host' | cut -d' ' -f1)
r "grep -q 'door=boot' /data/UserData/schwung/movy-host.log" && ok "it came through the boot door" || bad "movy-host.log does not say door=boot"
[ "$(r "stat -c %U /proc/$P")" = ableton ] && ok "as ableton" || bad "not as ableton"
PP=$(r "awk '/^PPid/{print \$2}' /proc/$P/status")
r "grep -q MoveLauncher /proc/$PP/cmdline" && ok "MoveLauncher supervises it (the pid it exec-ed is movy-host)" \
    || bad "parent is not MoveLauncher: $(r "tr '\0' ' ' </proc/$PP/cmdline")"
BLK=$(r "awk '/^SigBlk/{print \$2}' /proc/$P/status")
(( (16#${BLK:-0} >> 14) & 1 )) && bad "TERM is blocked in movy-host (SigBlk $BLK)" || ok "TERM is not blocked in movy-host (SigBlk $BLK)"
until_true 10 'pidof schwung-manager' && ok "schwung-manager is up (the store works from movy)" || bad "schwung-manager not running"
r 'pidof MoveOriginal' >/dev/null && bad "MoveOriginal runs beside movy" || ok "no Move beside it"

echo "2. stop → movy-host exits, Schwung does not start"
r "/etc/init.d/move stop" >/dev/null 2>&1
if until_true 12 '! pidof movy-host'; then ok "movy-host left on the stop"; else bad "movy-host survived the stop (TERM blocked?)"; fi
r "grep -q 'exit 5' /data/UserData/schwung/movy-host.log" && ok "with rc 5 (a stop, not a quit)" || bad "movy-host.log has no 'exit 5'"
sleep 3
r 'pidof MoveOriginal' >/dev/null && bad "Schwung/Move started after a STOP" || ok "nothing started after the stop"

echo "3. start → movy again"
r "touch /dev/shm/.movy-testbus; chown ableton:users /dev/shm/.movy-testbus; /etc/init.d/move start" >/dev/null 2>&1
if until_true 40 'pidof movy-host'; then ok "movy-host runs after start"; else bad "no movy-host after start"; fi
bus_up() { case "$(bus PING 2>/dev/null)" in OK*) return 0;; *) return 1;; esac; }
i=0; until bus_up || [ $i -ge 20 ]; do sleep 1; i=$((i + 1)); done
bus_up && ok "its test bus answers" || bad "no test bus"

echo "4. Close Movy → Schwung"
bus EXIT >/dev/null 2>&1
if until_true 40 'pidof shadow_ui'; then ok "Schwung is up after the quit"; else bad "no Schwung after the quit"; fi
r 'pidof movy-host' >/dev/null && bad "movy-host still running" || ok "movy-host is gone"
r "grep -q 'handing the device to Schwung' /data/UserData/schwung/movy-host.log" && ok "movy-host handed over" || bad "no handover line in movy-host.log"
M=$(r 'pidof MoveOriginal' | cut -d' ' -f1)
if [ -n "$M" ]; then
    MP=$(r "awk '/^PPid/{print \$2}' /proc/$M/status")
    r "grep -q MoveLauncher /proc/$MP/cmdline" && ok "Move runs under the same MoveLauncher (no crash restart)" \
        || bad "Move's parent is $(r "tr '\0' ' ' </proc/$MP/cmdline")"
fi

[ "$fails" = 0 ] && echo "BOOT TARGET OK" || echo "BOOT TARGET FAILED"
exit "$fails"
