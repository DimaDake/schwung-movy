#!/bin/sh
# Install (or update) Movy on an Ableton Move that already runs Schwung.
#
#   curl -fsSL https://raw.githubusercontent.com/DimaDake/schwung-movy/main/scripts/install-movy.sh | sh
#   ... | sh -s -- --boot            also make the Move power on into Movy
#   ... | sh -s -- --host 192.168.1.20
#
# It asks Schwung Manager (the web UI on the Move, port 7700) to install the
# catalog's Movy, exactly as its Install button does. Going through the manager
# rather than copying files keeps everything the manager does on install: the
# atomic swap of a module that may be running, and Movy's boot-picker entry.
set -eu

HOST="${MOVE_HOST:-move.local}"
BOOT=0
while [ $# -gt 0 ]; do
    case "$1" in
        --boot) BOOT=1 ;;
        --host) shift; HOST="${1:?--host needs a value}" ;;
        -h|--help) sed -n '2,7p' "$0" 2>/dev/null || true; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

BASE="http://$HOST:7700"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required"

# The manager guards every POST with a double-submit CSRF cookie: any GET sets it.
if ! curl -fsS --max-time 10 -c "$JAR" -o /dev/null "$BASE/modules"; then
    fail "cannot reach Schwung Manager at $BASE.
  Is the Move on, on this network, with Schwung 1.6.0 or newer installed?
  Install Schwung first: https://github.com/charlesvestal/schwung#installation
  (Use --host <ip> if move.local does not resolve.)"
fi
TOKEN="$(awk '$6 == "csrf_token" { print $7 }' "$JAR" | tail -n 1)"
[ -n "$TOKEN" ] || fail "Schwung Manager did not hand out a session token; update Schwung and retry"

# The manager answers an install with a redirect whose flash text says how it
# went; read it back from the final URL.
flash() {
    printf '%s' "$1" | sed -n 's/.*[?&]flash=\([^&]*\).*/\1/p' | sed 's/+/ /g; s/%3A/:/g; s/%2C/,/g; s/%27/'"'"'/g; s/%2F/\//g'
}

say "Installing Movy on $HOST (downloads the latest release; this can take a minute)..."
URL="$(curl -sS --max-time 600 -b "$JAR" -c "$JAR" -H "X-CSRF-Token: $TOKEN" \
    --data '' -L -o /dev/null -w '%{url_effective}' "$BASE/modules/movy/install")" \
    || fail "the install request did not complete"
MSG="$(flash "$URL")"
case "$URL" in
    *flash_type=error*) fail "${MSG:-install failed}" ;;
esac
say "${MSG:-Movy installed.}"

if [ "$BOOT" = 1 ]; then
    # Success and failure are both a redirect; only the flash type tells them apart.
    URL="$(curl -sS --max-time 30 -b "$JAR" -H "X-CSRF-Token: $TOKEN" \
        --data 'id=movy' -o /dev/null -w '%{redirect_url}' "$BASE/boot/default")" || URL="flash_type=error"
    case "$URL" in
        *flash_type=success*) ;;
        *) fail "Movy is installed, but setting it as the boot default failed: $(flash "$URL") (use Schwung Manager -> Boot)" ;;
    esac
    say "The Move will now power on into Movy. To change it: press Back during 'Loading Movy' at power-on."
fi

say "Open Movy from the Tools menu: hold Shift, touch the volume knob, click the jog wheel."
