#!/usr/bin/env bash
# The boot target (plan WP8): two doors into one body, and the rules that keep
# the boot from stranding the device. Each one only shows up on hardware, at
# boot, otherwise — the worst place to find out. Runs the REAL scripts against
# a fake movy-host; the content checks read code with comments stripped (a
# comment explaining a rule is not a violation of it — dbxhost's lesson).
set -u
cd "$(dirname "$0")/../.."
fails=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=1; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
code() { sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$1"; }
ENTRY=standalone/boot-entry.sh LAUNCH=standalone/launch.sh

echo "boot door"
# ---- module.json: the manager's registration, and first-match dispatch ----
check "module.json: standalone, no tool_config/capabilities, boot_target after id+name" python3 -c "
import json; t=open('module.json').read(); m=json.loads(t)
assert m['standalone'] is True and m['component_type'] == 'tool', 'not a standalone tool'
assert 'tool_config' not in m and 'capabilities' not in m, 'overtake keys left: first-match dispatch'
b=m['boot_target']; assert b == {'id':'movy','name':'Movy','exec':'boot-entry.sh'}, b
# the host reads module.json by FIRST textual occurrence: a block above id/name renames the module
assert t.index('\"boot_target\"') > t.index('\"id\"') and t.index('\"boot_target\"') > t.index('\"name\"')
assert 0 < len(b['name']) <= 24 and '\"' not in b['name'] and '\\\\' not in b['name']"

# ---- one body, two doors ----
check "boot-entry.sh EXECs the same launcher the Tools menu runs, with --boot" \
      grep -qx 'exec "\$LAUNCHER" --boot' <(code "$ENTRY")
check "...which is the module's own \`standalone\`" grep -q 'LAUNCHER=.*/standalone"$' <(code "$ENTRY")
check "a missing launcher still boots stock Move" grep -q 'exec /opt/move/MoveOriginal' <(code "$ENTRY")
if code "$ENTRY" | grep -qE '&[[:space:]]*$|setsid|nohup'; then bad "boot-entry.sh forks: the watchdog checks the pid it exec-ed"
else ok "boot-entry.sh does not fork"; fi

# ---- the door is an argument, never inherited ----
if code "$LAUNCH" | grep -qE 'export[[:space:]]+DOOR|DOOR:-|\$\{?MOVY_DOOR'; then
    bad "the door can come from the environment — it would leak into the next Schwung session"
else ok "the door is never exported nor read from the environment"; fi

# ---- MoveLauncher is our supervisor at boot ----
if code "$LAUNCH" | grep -qE 'MoveLauncher|pause-launcher|resume-launcher|killall|pkill'; then
    bad "the launcher kills or pauses something — at boot MoveLauncher supervises US"
else ok "no sweep and no launcher pause"; fi

# ---- behaviour: run the real scripts against a fake movy-host ----
T=$(mktemp -d "${TMPDIR:-/tmp}/movy-boot-door.XXXXXX"); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/mod" "$T/shm"
cp "$LAUNCH" "$T/mod/standalone"; cp "$ENTRY" "$T/mod/boot-entry.sh"
printf '#!/bin/sh\necho "args:$*" > "%s/ran"\n' "$T" > "$T/mod/movy-host"
chmod +x "$T/mod/standalone" "$T/mod/boot-entry.sh" "$T/mod/movy-host"
args() { cat "$T/ran" 2>/dev/null; rm -f "$T/ran"; }
MOVY_SHM="$T/shm" "$T/mod/boot-entry.sh"; got=$(args)
check "boot picker -> movy-host --boot (got '$got')" test "$got" = "args:--boot"
MOVY_SHM="$T/shm" "$T/mod/standalone"; got=$(args)
check "Tools menu -> movy-host with no door (got '$got')" test "$got" = "args:"
DOOR=boot MOVY_SHM="$T/shm" "$T/mod/standalone"; got=$(args)
check "an inherited DOOR=boot is inert (got '$got')" test "$got" = "args:"
MOVY_SHM="$T/shm" "$T/mod/standalone" --bogus; rc=$?
check "an unknown argument is refused, not guessed (rc $rc)" test "$rc" = 2

# ---- controls: the absence checks can fire ----
printf 'export DOOR=boot\n' > "$T/c1"; code "$T/c1" | grep -qE 'export[[:space:]]+DOOR' \
    && ok "control: an exported door IS detected" || bad "control: the export check is inert"
printf '# MoveLauncher in a comment\n' > "$T/c2"; code "$T/c2" | grep -q MoveLauncher \
    && bad "control: a comment counts as code" || ok "control: comments are not code"

[ "$fails" = 0 ] && echo "BOOT DOOR OK" || echo "BOOT DOOR FAILED"
exit "$fails"
