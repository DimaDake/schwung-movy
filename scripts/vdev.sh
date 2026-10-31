#!/usr/bin/env bash
# vdev.sh — the virtual device (plan WP12): movy-host with a fake SPI
# (host/vdev/spi_fake.c) in an aarch64 container on colima, carrying a copy
# of a real Move's /data, so the device tier runs with no hardware and, one
# container per shard, in parallel. The device tier stays the gate for
# anything hardware-timed; this is the fast loop before it.
#
#   vdev.sh snapshot [host]     copy a Move's /data (default move.local)
#   vdev.sh image               build the image from the snapshot
#   vdev.sh up [N]              start vdev<N> (default 0); deploys nothing
#   vdev.sh down [N|all]
#   vdev.sh env [N]             print the exports that point ssh/scp/Node at vdev<N>
#   vdev.sh test [N] [run.mjs args...]    the device tier against vdev<N>
#   vdev.sh tier [jobs] [run.mjs args...] every scenario, sharded over vdev0..jobs-1
#
# vdev<N> is ssh 127.0.0.1:2300+N and the test bus 127.0.0.1:48777+N
# (test-device/vdev.ts). State lives in .vdev/ (gitignored): the snapshot,
# the harness's ssh key and config.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$DIR/.vdev"
IMAGE=movy-vdev
SSH_BASE=2300
BUS_BASE=48777   # test-device/vdev.ts VDEV_BUS_BASE
mkdir -p "$STATE"

die() { echo "vdev: $*" >&2; exit 1; }
need_docker() { docker info >/dev/null 2>&1 || die "no docker daemon (colima start)"; }

# What a scenario can need from /data, and nothing that is only bulk: sfz's
# instrument library alone is 600 MB, Samples 22 GB (a few small files of it
# go in, for the file browser's scenarios).
EXCLUDES='*.log
*.log.keep
*.pcm
.backup-*
shared-backup-*
_movy-*
schwung/cache
schwung/tmp
sound_generators/sfz/instruments'

snapshot() {
    local host="${1:-move.local}" out="$STATE/image/snapshot.tar"
    mkdir -p "$STATE/image"
    echo "vdev: snapshot of $host:/data -> $out"
    # As root: a few files the stack wrote as root are unreadable to ableton.
    ssh "root@$host" "cat > /tmp/vdev-x <<'X'
$EXCLUDES
X
cd /data && find UserData/UserLibrary/Samples -type f -size -400k \\( -iname '*.wav' -o -iname '*.aif*' \\) \
    | head -n 60 > /tmp/vdev-samples
tar c -X /tmp/vdev-x -T /tmp/vdev-samples UserData/schwung UserData/boot-targets \
    UserData/UserLibrary/Movy UserData/UserLibrary/Sets 'UserData/UserLibrary/Track Presets' \
    UserData/UserLibrary/Wavetables 2>/dev/null; rm -f /tmp/vdev-x /tmp/vdev-samples" > "$out.part"
    mv "$out.part" "$out"
    ssh "ableton@$host" "cat /data/UserData/schwung/host/version.txt" > "$STATE/image/schwung-version"
    echo "vdev: $(du -h "$out" | cut -f1), schwung $(cat "$STATE/image/schwung-version")"
}

image() {
    need_docker
    [[ -f "$STATE/image/snapshot.tar" ]] || die "no snapshot (vdev.sh snapshot)"
    cp "$DIR"/vdev/image/{Dockerfile,move.sh,init-move.sh,entrypoint.sh} "$STATE/image/"
    docker build -q -t "$IMAGE" "$STATE/image"
}

key() {
    [[ -f "$STATE/id_ed25519" ]] || ssh-keygen -q -t ed25519 -N '' -C movy-vdev -f "$STATE/id_ed25519"
}

# One config for every instance; the user's own follows, for real hosts.
# Written aside and renamed: tier's shards start containers side by side.
ssh_config() {
    local cfg="$STATE/ssh_config" tmp n
    tmp=$(mktemp "$STATE/ssh_config.XXXXXX")
    {
        for n in $(seq 0 15); do
            printf 'Host vdev%s\n  HostName 127.0.0.1\n  Port %s\n' "$n" $((SSH_BASE + n))
            printf '  IdentityFile %s\n  IdentitiesOnly yes\n' "$STATE/id_ed25519"
            printf '  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n  LogLevel ERROR\n'
        done
        printf 'Match all\nInclude ~/.ssh/config\n'
    } > "$tmp"
    mv "$tmp" "$cfg"
}

env_for() {
    local n="${1:-0}"
    echo "export PATH=\"$DIR/vdev/bin:\$PATH\" MOVY_VDEV=1 MOVY_VDEV_SSH_CONFIG=\"$STATE/ssh_config\" HOST=vdev$n"
}

up() {
    local n="${1:-0}" name="movy-vdev${1:-0}"
    need_docker; key; ssh_config
    docker image inspect "$IMAGE" >/dev/null 2>&1 || die "no image (vdev.sh image)"
    docker rm -f "$name" >/dev/null 2>&1 || true
    # /dev/shm: movy-host's rings, the session lock and the vspi mailbox.
    # SYS_PTRACE: root reads another uid's /proc/<pid>/maps on the box (smoke's
    # chain-host check), and a container's root may not without it.
    docker run -d --name "$name" --hostname "vdev$n" --shm-size=256m --cap-add SYS_PTRACE \
        -p "127.0.0.1:$((SSH_BASE + n)):22" -p "127.0.0.1:$((BUS_BASE + n)):47777" \
        -v "$STATE/id_ed25519.pub:/vdev-key.pub:ro" "$IMAGE" >/dev/null
    local i
    for i in $(seq 1 50); do
        MOVY_VDEV_SSH_CONFIG="$STATE/ssh_config" "$DIR/vdev/bin/ssh" -o BatchMode=yes -o ConnectTimeout=2 \
            "ableton@vdev$n" true 2>/dev/null && { echo "vdev$n up"; return 0; }
        sleep 0.2
    done
    die "vdev$n: no ssh after 10 s ($(docker logs "$name" 2>&1 | tail -3))"
}

down() {
    if [[ "${1:-0}" = all ]]; then
        docker ps -aq --filter "name=^movy-vdev" | xargs -r docker rm -f >/dev/null
    else
        docker rm -f "movy-vdev${1:-0}" >/dev/null 2>&1 || true
    fi
}

test_one() {
    local n="${1:-0}"; shift || true
    eval "$(env_for "$n")"
    cd "$DIR" && node build/test-device.mjs && node test-device/run.mjs --host "vdev$n" "$@"
}

# Every scenario, one shard per container, all at once. Built ONCE here
# (MOVY_PREBUILT: the shards only copy), each shard on a fresh container, so
# no shard inherits another's state. Shards are balanced on the last tier's
# timings when there are any (longest first onto the least loaded).
tier() {
    local jobs="${1:-2}"; shift || true
    eval "$(env_for 0)"
    cd "$DIR"
    # One command per line: errexit ignores a failure inside an && list, which
    # once let a broken movy-host build run the tier on yesterday's binary.
    node build/test-device.mjs >/dev/null
    node build/device.mjs >/dev/null
    ./scripts/build-dsp.sh >/dev/null
    MOVY_VDEV=1 ./scripts/build-host.sh
    ./scripts/build-schwung-js.sh
    local shards
    shards=$(node -e '
        const fs = require("fs"), [jobs, dir] = [Number(process.argv[1]), process.argv[2]];
        const names = fs.readdirSync("test-device/scenarios").filter((f) => f.endsWith(".ts")).map((f) => f.slice(0, -3));
        const secs = {};
        for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
            try { for (const r of JSON.parse(fs.readFileSync(`${dir}/${d}/run.json`, "utf8"))) secs[r.name] = r.seconds; } catch {}
        }
        const load = Array.from({ length: jobs }, () => ({ s: 0, n: [] }));
        for (const n of names.sort((a, b) => (secs[b] ?? 60) - (secs[a] ?? 60))) {
            const l = load.reduce((m, x) => (x.s < m.s ? x : m));
            l.s += secs[n] ?? 60; l.n.push(n);
        }
        console.log(load.map((l) => l.n.join(",")).join("\n"));' "$jobs" "$STATE/out")
    local n=0 pids=() logs=()
    rm -rf "$STATE/out" && mkdir -p "$STATE/out"
    while read -r only; do
        [[ -n "$only" ]] || continue
        local log="$STATE/out/shard-$n.log"
        (   up "$n" >/dev/null && export MOVY_PREBUILT=1 HOST="vdev$n" \
            && ./scripts/deploy.sh "vdev$n" >/dev/null 2>&1 \
            && node test-device/run.mjs --host "vdev$n" --scenario "$only" --out "$STATE/out/vdev$n" "$@"
        ) >"$log" 2>&1 &
        pids+=($!) logs+=("$log")
        echo "vdev$n: $only"
        n=$((n + 1))
    done <<<"$shards"
    local rc=0 i
    for i in "${!pids[@]}"; do wait "${pids[$i]}" || rc=1; done
    for i in "${!logs[@]}"; do echo "── vdev$i"; grep -E '✓|✗|⚠|N/A|scenarios ·' "${logs[$i]}" || tail -5 "${logs[$i]}"; done
    echo "vdev tier: $([[ $rc = 0 ]] && echo GREEN || echo RED) ($jobs shards; reports in .vdev/out/)"
    return $rc
}

cmd="${1:-}"; shift || true
case "$cmd" in
    snapshot) snapshot "$@" ;;
    image)    image ;;
    up)       up "$@" ;;
    down)     down "$@" ;;
    env)      key; ssh_config; env_for "$@" ;;
    test)     test_one "$@" ;;
    tier)     tier "$@" ;;
    *) sed -n '2,20p' "$0" >&2; exit 2 ;;
esac
