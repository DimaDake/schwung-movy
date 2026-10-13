# shellcheck shell=bash
# deploy_host HOST — install movy's standalone half (plan WP8) into tools/movy:
# movy-host, its RT helper, the launcher (`standalone`), the boot entry,
# module.json and the pinned schwung JS (schwung/). deploy.sh ships ui.js, dsp.so, chain-host.so and configs.
#
# Also retires movy-sa, the WP6-WP7 side-by-side dev tool: tools/movy IS the
# standalone module now, and a second one would race it for SPI and the bus.
#
# The store registers the boot picker row from module.json's boot_target; an
# scp deploy bypasses the store, so the row is written here — unowned, which
# the manager adopts at its next reconcile because `exec` lies inside this
# payload (schwung docs/BOOT_TARGETS.md). Never the default: picking movy as
# the default is the user's choice in the boot window.
deploy_host() {
    local host="$1" dir remote=/data/UserData/schwung/modules/tools/movy bt=/data/UserData/boot-targets/movy
    dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    # MOVY_PREBUILT: scripts/vdev.sh tier built it once for all its shards.
    if [[ "${MOVY_PREBUILT:-0}" != 1 ]]; then
        "$dir/scripts/build-host.sh"
        "$dir/scripts/build-schwung-js.sh"
    fi
    # The virtual device runs the fake-SPI build (scripts/vdev.sh, plan WP12).
    local dist="$dir/dist"
    [[ "${MOVY_VDEV:-0}" = 1 ]] && dist="$dir/dist/vdev"
    ssh "ableton@$host" "mkdir -p $remote"
    # Fresh inodes for everything a running movy-host may have mapped, and
    # for the launcher: sh reads a script as it runs, and a holding launcher
    # (harness mode) is mid-loop in it.
    scp -q "$dist/movy-host" "ableton@$host:$remote/movy-host.new"
    scp -q "$dir/standalone/launch.sh" "ableton@$host:$remote/standalone.new"
    scp -q "$dist/movy-heal" "$dir/standalone/boot-entry.sh" "$dir/module.json" "ableton@$host:$remote/"
    # The pinned schwung JS (plans/2026-10-13-pin-schwung-js.md), as a whole
    # new directory swapped in: a running movy-host loaded its copy at start.
    ssh "ableton@$host" "rm -rf $remote/schwung.new"
    scp -qr "$dir/dist/schwung-js" "ableton@$host:$remote/schwung.new"
    ssh "ableton@$host" "cd $remote && chmod +x movy-host.new standalone.new movy-heal boot-entry.sh \
        && mv movy-host.new movy-host && mv standalone.new standalone \
        && rm -rf schwung.old && { [ ! -d schwung ] || mv schwung schwung.old; } && mv schwung.new schwung && rm -rf schwung.old \
        && rm -rf /data/UserData/schwung/modules/tools/movy-sa \
        && if [ -d /data/UserData/boot-targets ] && [ ! -f $bt/boot.json ]; then mkdir -p $bt \
           && printf '{\n  \"name\": \"Movy\",\n  \"exec\": \"$remote/boot-entry.sh\"\n}\n' > $bt/boot.json; fi"
    echo "movy-host deployed to $host:$remote ($(ssh "ableton@$host" "$remote/movy-host --version"))"
}
