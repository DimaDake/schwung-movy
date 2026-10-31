#!/bin/sh
# Install Movy on an Ableton Move in one go: Schwung (the version this Movy
# release is tested with) if it is missing or older, then Movy, optional sound
# modules, and Movy as the power-on default.
#
#   curl -fsSL https://raw.githubusercontent.com/DimaDake/schwung-movy/main/scripts/install-movy.sh | sh
#   ... | sh -s -- --modules dexed,mrdrums,mverb
#
# Options:
#   --modules a,b,c      also install these catalog modules (ids as in Schwung's catalog)
#   --no-boot            do not make Movy the power-on default
#   --schwung MODE       pinned (default): install the Schwung this Movy release
#                          pins when Schwung is missing or older; never downgrades
#                        latest: Schwung's newest release, same rule
#                        skip: leave Schwung alone
#   --screen-reader      turn on Schwung's screen reader (only when Schwung is installed now)
#   --host NAME          the Move's address (default move.local)
#   --yes                skip Schwung's "unsupported by Ableton" confirmation
#
# Schwung is installed by its own installer (SSH setup included). Movy and the
# modules go through Schwung Manager's Install endpoint, as its web page does,
# so the manager's atomic swap and Movy's boot-picker entry apply as usual.
set -eu

REPO="DimaDake/schwung-movy"
HOST="${MOVE_HOST:-move.local}"
BOOT=1
SCHWUNG_MODE=pinned
MODULES=""
SCREEN_READER=0
YES=0
while [ $# -gt 0 ]; do
    case "$1" in
        --modules) shift; MODULES="${1:?--modules needs a list}" ;;
        --modules=*) MODULES="${1#*=}" ;;
        --no-boot) BOOT=0 ;;
        --boot) BOOT=1 ;;
        --schwung) shift; SCHWUNG_MODE="${1:?--schwung needs pinned|latest|skip}" ;;
        --schwung=*) SCHWUNG_MODE="${1#*=}" ;;
        --screen-reader) SCREEN_READER=1 ;;
        --host) shift; HOST="${1:?--host needs a value}" ;;
        --host=*) HOST="${1#*=}" ;;
        --yes|-y) YES=1 ;;
        -h|--help) sed -n '2,23p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
    shift
done
case "$SCHWUNG_MODE" in pinned|latest|skip) ;; *) echo "--schwung must be pinned, latest or skip" >&2; exit 2 ;; esac

BASE="http://$HOST:7700"
TMP="$(mktemp -d)"
JAR="$TMP/cookies"
trap 'rm -rf "$TMP"' EXIT

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail "curl is required"

# a.b.c >= x.y.z, numerically per field ("v" prefixes ignored).
version_ge() {
    awk -v a="${1#v}" -v b="${2#v}" 'BEGIN {
        n = split(a, x, "."); m = split(b, y, "."); k = n > m ? n : m
        for (i = 1; i <= k; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
        exit 0 }'
}

# ---- 1. which Movy, and which Schwung it is built against -------------------
step "Finding the latest Movy release"
RELEASE="$(curl -fsSL "https://raw.githubusercontent.com/$REPO/main/release.json")" \
    || fail "cannot reach GitHub; is this computer online?"
MOVY_VERSION="$(printf '%s' "$RELEASE" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$MOVY_VERSION" ] || fail "could not read Movy's release.json"
say "Movy $MOVY_VERSION"

PIN=""
if [ "$SCHWUNG_MODE" = pinned ]; then
    PIN="$(curl -fsSL "https://raw.githubusercontent.com/$REPO/v$MOVY_VERSION/scripts/lib/schwung-pin.sh" 2>/dev/null \
        | sed -n 's/.*SCHWUNG_PIN_TAG:-\(v[0-9][0-9.]*\)}.*/\1/p' | head -n 1)"
    [ -n "$PIN" ] || fail "could not read the Schwung version Movy $MOVY_VERSION is tested with"
    say "tested with Schwung $PIN"
fi

# ---- 2. Schwung ----------------------------------------------------------
manager_up() { curl -fsS --max-time 5 -o /dev/null "$BASE/modules" 2>/dev/null; }
installed_schwung() {
    curl -fsS --max-time 5 "$BASE/files/download?path=/data/UserData/schwung/host/version.txt" 2>/dev/null \
        | tr -d ' \r\n' || true
}

if [ "$SCHWUNG_MODE" != skip ]; then
    step "Checking Schwung on $HOST"
    HAVE=""
    manager_up && HAVE="$(installed_schwung)"
    WANT="$PIN"
    if [ "$SCHWUNG_MODE" = latest ]; then
        WANT="$(curl -fsSL "https://api.github.com/repos/charlesvestal/schwung/releases" \
            | sed -n 's/.*"tag_name": *"\(v[0-9][^"]*\)".*/\1/p' | head -n 1)"
        [ -n "$WANT" ] || fail "could not find Schwung's latest release"
    fi
    if [ -n "$HAVE" ] && version_ge "$HAVE" "$WANT"; then
        say "Schwung $HAVE is installed (wanted $WANT or newer): keeping it."
    else
        if [ -n "$HAVE" ]; then say "Schwung $HAVE is installed; updating to $WANT."
        elif manager_up; then say "Schwung is installed but its version is unknown; installing $WANT."
        else say "Schwung is not installed (or the Move is not reachable yet); installing $WANT."; fi
        # Schwung's own installer, at the wanted tag, in its `local` mode: it
        # installs the tarball beside its scripts/ dir as-is (with no
        # schwung-manager/ source next to it, it builds nothing).
        mkdir -p "$TMP/schwung/scripts"
        curl -fsSL -o "$TMP/schwung/scripts/install.sh" \
            "https://raw.githubusercontent.com/charlesvestal/schwung/$WANT/scripts/install.sh" \
            || fail "could not download Schwung's installer for $WANT"
        curl -fL --progress-bar -o "$TMP/schwung/schwung.tar.gz" \
            "https://github.com/charlesvestal/schwung/releases/download/$WANT/schwung.tar.gz" \
            || fail "could not download Schwung $WANT"
        set -- local --skip-modules "--host=$HOST"
        [ "$YES" = 1 ] && set -- "$@" --skip-confirmation
        [ "$SCREEN_READER" = 1 ] && set -- "$@" --enable-screen-reader
        ( cd "$TMP/schwung" && sh scripts/install.sh "$@" ) || fail "Schwung's installer did not finish"
    fi
fi

# ---- 3. Movy and modules, through Schwung Manager ------------------------
step "Waiting for Schwung Manager at $BASE"
i=0
until manager_up; do
    i=$((i + 1))
    [ "$i" -le 60 ] || fail "Schwung Manager did not come up at $BASE (is Schwung installed? use --host <ip> if move.local does not resolve)"
    sleep 3
done
curl -fsS --max-time 10 -c "$JAR" -o /dev/null "$BASE/modules" || fail "Schwung Manager stopped answering"
TOKEN="$(awk '$6 == "csrf_token" { print $7 }' "$JAR" | tail -n 1)"
[ -n "$TOKEN" ] || fail "Schwung Manager did not hand out a session token; update Schwung and retry"

flash() {
    printf '%s' "$1" | sed -n 's/.*[?&]flash=\([^&]*\).*/\1/p' \
        | sed 's/+/ /g; s/%3A/:/g; s/%2C/,/g; s/%27/'"'"'/g; s/%2F/\//g'
}
# The manager answers an install with a redirect whose flash says how it went.
install_module() {
    url="$(curl -sS --max-time 600 -b "$JAR" -c "$JAR" -H "X-CSRF-Token: $TOKEN" \
        --data '' -L -o /dev/null -w '%{url_effective}' "$BASE/modules/$1/install")" || return 1
    msg="$(flash "$url")"
    case "$url" in *flash_type=error*) say "  $1: ${msg:-failed}"; return 1 ;; esac
    say "  ${msg:-$1 installed}"
}

step "Installing Movy (this downloads the release; it can take a minute)"
install_module movy || fail "Movy did not install"

FAILED=""
if [ -n "$MODULES" ]; then
    step "Installing modules: $MODULES"
    for m in $(printf '%s' "$MODULES" | tr ',' ' '); do
        install_module "$m" || FAILED="$FAILED $m"
    done
fi

if [ "$BOOT" = 1 ]; then
    step "Making Movy the power-on default"
    url="$(curl -sS --max-time 30 -b "$JAR" -H "X-CSRF-Token: $TOKEN" \
        --data 'id=movy' -o /dev/null -w '%{redirect_url}' "$BASE/boot/default")" || url=""
    case "$url" in
        *flash_type=success*) say "  done" ;;
        *) fail "Movy is installed, but setting it as the boot default failed: $(flash "$url") (use Schwung Manager -> Boot)" ;;
    esac
fi

step "All set"
[ -n "$FAILED" ] && say "These modules did not install:$FAILED (install them from $BASE/modules)"
if [ "$BOOT" = 1 ]; then
    say "Restart the Move: it starts in Movy. To change that, press Back during 'Loading Movy' at power-on."
else
    say "Open Movy from the Tools menu: hold Shift, touch the volume knob, click the jog wheel."
fi
say "Manual: https://dimadake.github.io/schwung-movy/manual/quick-start/"
