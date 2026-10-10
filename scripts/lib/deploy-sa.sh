# shellcheck shell=bash
# deploy_sa HOST — install the movy-sa dev tool (plan WP6) beside movy.
#
# ui.js and dsp.so are byte-identical to the overtake install's, copied from
# dist/ after deploy.sh has built and shipped them: movy-sa must never run a
# different movy than the one it is being compared with. Its data (prefs,
# configs, chain-host.so, Sets) is the overtake install's on purpose — ui.js
# names tools/movy itself, and it is the same user's movy.
deploy_sa() {
    local host="$1" dir remote=/data/UserData/schwung/modules/tools/movy-sa
    dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    "$dir/scripts/build-host.sh"
    ssh "ableton@$host" "mkdir -p $remote"
    # Fresh inodes for everything that may be mapped by a running movy-host.
    scp -q "$dir/dist/movy-host" "ableton@$host:$remote/movy-host.new"
    scp -q "$dir/dist/dsp.so" "ableton@$host:$remote/dsp.so.new"
    scp -q "$dir/dist/movy-heal" "$dir/ui.js" "ableton@$host:$remote/"
    scp -q "$dir/standalone/module.json" "ableton@$host:$remote/module.json"
    scp -q "$dir/standalone/launch.sh" "ableton@$host:$remote/standalone"
    ssh "ableton@$host" "cd $remote && mv movy-host.new movy-host && mv dsp.so.new dsp.so && chmod +x movy-host standalone movy-heal"
    echo "movy-sa deployed to $host:$remote ($(ssh "ableton@$host" "$remote/movy-host --version"))"
}
