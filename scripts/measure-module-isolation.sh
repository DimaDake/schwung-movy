#!/usr/bin/env bash
# measure-module-isolation.sh — do two chains of the same module share state?
#
# The parallel-render design is blocked on schwung review §6: `chain_host.c:438`
# loads every synth with `dlopen(dsp_path, RTLD_NOW | RTLD_LOCAL)`, and
# RTLD_LOCAL controls symbol VISIBILITY, not mapping identity. glibc dedups by
# (st_dev, st_ino), so two chains holding the same module are BELIEVED to share
# one mapping — and therefore that module's whole `.data`/`.bss`. Serial render
# makes that safe by construction; parallel render would not.
#
# "Believed" was the problem. Everything downstream — whether movy must copy a
# .so per chain, whether the 78-module fleet needs auditing at all — rests on
# it, and it had never been observed on this device. A mapping is directly
# countable in /proc/<pid>/maps, so this counts it instead of arguing from the
# man page, then proves the fix by loading a byte-copy and counting again.
#
# **Needs root** for /proc/<pid>/maps: MoveOriginal runs as root, and as
# `ableton` the file reads back EMPTY rather than failing — which looks exactly
# like "the module is not mapped" and is how this first reported 0.
#
# Usage: ./scripts/measure-module-isolation.sh [move.local] [module]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
MOD="${2:-plaits}"
ISO="${MOD}-iso1"

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
source "$MOVY_DIR/scripts/lib/chain-bench.sh"

SG=/data/UserData/schwung/modules/sound_generators
BLD=$'\033[1m'; RST=$'\033[0m'; GRN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh -o ConnectTimeout=5 "root@$HOST" true 2>/dev/null || { echo "NEEDS ROOT SSH — /proc/<pid>/maps reads empty as ableton"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

# One WRITABLE segment per dlopen'd mapping. Counting `rw-p` rather than lines
# is the point: a single mapping contributes four segments (text/rodata/data/
# bss), and it is specifically the writable one that two chains would share.
maps_rw() { # maps_rw <dir-name>
    ssh "root@$HOST" "pid=\$(pgrep -f MoveOriginal | head -n 1)
        grep -c 'rw-p.*/$1/dsp.so' /proc/\$pid/maps 2>/dev/null || echo 0"
}

echo "${BLD}=== module isolation: one mapping, or two? ===${RST}"
echo "host=$HOST  module=$MOD"

ts_open_movy
sleep 8
cb_require_engine_link

# ── 1. the premise: same module, two chains ──────────────────────────────────
ep "ch0:synth:module" "$MOD"; sleep 2
ep "ch1:synth:module" "$MOD"; sleep 4
SHARED=$(maps_rw "$MOD")

echo
echo "${BLD}two chains, same module path${RST}"
echo "  writable (.data/.bss) mappings of $MOD/dsp.so: ${BLD}${SHARED}${RST}"
[ "${SHARED:-0}" -eq 1 ] \
    && echo "  ${RED}SHARED${RST} — both chains render through ONE copy of its mutable state." \
    || echo "  ${YEL}unexpected (${SHARED}) — did both chains load? check the log.${RST}"

# ── 2. the fix: a byte copy gets its own inode, and its own statics ──────────
# A symlink or hard link is deduped straight back to the original, because the
# dedup key is the inode. Only a real copy separates them. Everything else in
# the module directory is symlinked: it is read with fopen, which does not care,
# and the assets (ROMs, wavetables, soundfonts) are the bulk of the bytes.
ssh "root@$HOST" "
    rm -rf $SG/$ISO && mkdir -p $SG/$ISO
    cp $SG/$MOD/dsp.so $SG/$ISO/dsp.so
    for f in $SG/$MOD/*; do
        b=\$(basename \$f)
        [ \"\$b\" = dsp.so ] || ln -sf \"\$f\" \"$SG/$ISO/\$b\"
    done
    chown -R ableton:users $SG/$ISO" >/dev/null 2>&1

ep "ch1:synth:module" "$ISO"; sleep 5
A=$(maps_rw "$MOD"); B=$(maps_rw "$ISO")

echo
echo "${BLD}two chains, one on a private byte-copy${RST}"
echo "  writable mappings — $MOD: ${BLD}${A}${RST}   $ISO: ${BLD}${B}${RST}"
if [ "${A:-0}" -ge 1 ] && [ "${B:-0}" -ge 1 ]; then
    echo "  ${GRN}SEPARATE${RST} — each chain has its own .data/.bss."
    echo "  This needs NO schwung change: the chain host resolves a synth as"
    echo "  <module_dir>/../sound_generators/<name>, and movy owns module_dir."
else
    echo "  ${RED}the copy did not load${RST} — check the log for 'Loading synth'."
fi

# ── 3. what the copy costs, since it would sit next to the dlopen ────────────
# busybox `date` has no %N, so a single copy cannot be timed directly; time a
# run of five and divide. Cold vs warm matters — the source is NOT in page
# cache the first time a module is used, which is exactly when the copy happens.
echo
echo "${BLD}cost of the copy (frame budget is 2902 us)${RST}"
ssh "root@$HOST" "
    D=/data/UserData/schwung/modules/tools/movy/iso-probe; mkdir -p \$D
    for m in \$(ls -S $SG/*/dsp.so 2>/dev/null | head -n 3); do
        name=\$(basename \$(dirname \$m))
        kb=\$(( \$(stat -c %s \$m) / 1024 ))
        sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null
        cold=\$( { time cp \$m \$D/p.so ; } 2>&1 | awk '/real/{print \$2}')
        warm=\$( { time ( for i in 1 2 3 4 5; do cp \$m \$D/p\$i.so; done ) ; } 2>&1 | awk '/real/{print \$2}')
        printf '  %-14s %6d KB   cold %s   warm(x5) %s\n' \"\$name\" \$kb \"\$cold\" \"\$warm\"
        rm -f \$D/p*.so
    done
    rm -rf \$D"

echo
echo "${YEL}A copy is tens to hundreds of ms — 20 to 90 dropped frames. It cannot"
echo "happen on the load path, which is the audio thread. It has to be a warmed"
echo "cache (like chain_copy.rs), populated before the module is needed.${RST}"

ep "ch1:synth:module" ""; sleep 1
ssh "root@$HOST" "rm -rf $SG/$ISO" >/dev/null 2>&1
ep "ch0:synth:module" ""
