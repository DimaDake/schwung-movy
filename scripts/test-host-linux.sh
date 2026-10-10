#!/usr/bin/env bash
# test-host-linux.sh — movy-host's unit tests under glibc, in an ubuntu
# container (dbxhost's lesson: macOS and glibc disagree on opaque types such
# as sigset_t, so a native pass on the Mac is not proof). The seed of WP12's
# virtual device.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if ! docker info >/dev/null 2>&1; then
    echo "test-host-linux: no docker daemon (colima start?)" >&2
    exit 1
fi
docker run --rm -v "$DIR/host:/host:ro" -e TMPDIR=/tmp ubuntu:22.04 \
    bash -c 'apt-get -qq update >/dev/null && apt-get -qq install -y gcc >/dev/null && CC=gcc /host/tests/run.sh'
