#!/usr/bin/env bash
# test-items.sh — device e2e for item selectors (bank / soundfont / model
# pickers built from a ui_hierarchy level's items_param + select_param).
#
# What only a device can answer: whether a real module actually serves the
# contract in the shape movy assumes. Neither `syx_bank_list` nor
# `syx_bank_index` appears in chain_params, so nothing in the module dump
# records them — the local suites run against a hand-written fixture.
#
# Dexed is the reference: its `banks` level declares
# items_param=syx_bank_list / select_param=syx_bank_index, and choosing a bank
# loads a .syx and resets the preset (schwung-dx7 dx7_plugin.cpp:585).
#
# The signals are movy's debug log:
#   items selector syx_bank_index n=<N>   (the cell was built from a real list)
#   set slot=<s> gi=<n> key=synth:syx_bank_index val=<n>   (the commit)
#   loadHierarchy: ...                    (the settle-then-re-read afterwards)
#
# The module is loaded into the track's SYNTH slot and the slot's previous
# contents are restored on exit, so a user's Set survives the run.
#
# Requires schwung-midi-inject-ui.py one directory up.
# Usage: ./scripts/test-items.sh [host]   (default: move.local)

set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"

# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin || { echo "could not establish the fixture state"; exit 1; }
REMOTE="/data/UserData/schwung/modules/tools/movy"
LOG=/data/UserData/schwung/debug.log
SLOT=0
MODULE=dexed
SELECT_KEY=syx_bank_index

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${YLW}→${RST} $1"; }
FAILURES=0

inj()   { python3 "$INJECT" "$HOST" "$@" >/dev/null 2>&1; }
burst() { python3 "$MOVY_DIR/scripts/inject-burst.py" "$HOST" "$@" >/dev/null 2>&1; }

# Same de-duplication as test-module-contract.sh: two sinks write debug.log, so
# every line appears twice. These assertions COUNT events, so a raw count would
# double the commit and report a per-detent write that never happened.
movylog() {
    ssh "ableton@$HOST" "grep '\[movy\]' $LOG 2>/dev/null || true" \
        | sed -E 's/\[[A-Z ]+\] \[[a-z-]+\] //' \
        | awk '{
            split($1, c, ":"); now = c[1]*3600 + c[2]*60 + c[3]
            msg = $0; sub(/^[^ ]+ /, "", msg)
            if (msg in last && now - last[msg] < 0.005) next
            last[msg] = now; print
        }'
}

CC_CLICK=3; CC_BACK=51
KNOB_CC=71        # knob 1 — the selector sits leftmost, before the preset cell
KNOB_NOTE=0       # knob 1
# Knob touch AND release are both note-ON (0x90): d2>0 presses, d2=0 releases.
# midi/router.ts dispatches the knob branch on 0x90 only, so a real note-off
# (0x80) is silently dropped and the picker is never committed.

ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || {
    echo -e "${RED}Cannot reach $HOST${RST}"; exit 1; }
pass "SSH reachable"

info "Building and deploying movy..."
cd "$MOVY_DIR"
node build/device.mjs >/dev/null 2>&1
ssh "ableton@$HOST" "mkdir -p $REMOTE" >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE/"
pass "Built + deployed"

# Unlike test-module-contract.sh, which borrows the fixture's EMPTY FX 1 slot,
# this borrows the SYNTH slot the fixture itself owns. A read that races the
# stack restart comes back empty, and restoring that empty reading would leave
# the fixture's own module unloaded — so fall back to what the fixture declares
# rather than to "none".
FIXTURE_SYNTH=$(node -e "
  const f='$MOVY_DIR/scripts/fixtures/device-set/slot_$SLOT.json';
  try { process.stdout.write(require(f).chain?.synth?.module ?? require(f).synth?.module ?? ''); }
  catch { process.stdout.write(''); }" 2>/dev/null || echo "")
PREV=$(node "$MOVY_DIR/scripts/module-slot.mjs" get "$SLOT" synth 2>/dev/null || echo "")
PREV="${PREV:-$FIXTURE_SYNTH}"
info "Synth slot previously: '${PREV:-<empty>}' — loading $MODULE"
restore() {
    info "Restoring synth to '${PREV:-<empty>}'"
    node "$MOVY_DIR/scripts/module-slot.mjs" set "$SLOT" synth "${PREV:-none}" >/dev/null 2>&1 || true
    test_set_end
}
trap restore EXIT INT TERM
node "$MOVY_DIR/scripts/module-slot.mjs" set "$SLOT" synth "$MODULE" >/dev/null 2>&1
pass "$MODULE loaded into the synth slot"

info "Reopening movy and entering the synth knob page..."
for _ in 1 2 3; do inj cc $CC_BACK 127; sleep 0.12; inj cc $CC_BACK 0; sleep 0.15; done
ssh "ableton@$HOST" "touch /data/UserData/schwung/debug_log_on; > $LOG" >/dev/null 2>&1
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' >/dev/null 2>&1
sleep 3
ts_focus_track0
inj cc $CC_CLICK 127; sleep 0.15; inj cc $CC_CLICK 0; sleep 1.5   # chain → knobs
HIER=$(movylog | grep "loadHierarchy:" | tail -1 || true)
[ -n "$HIER" ] && pass "Hierarchy loaded: ${HIER##*movy] }" \
                || fail "No loadHierarchy after entering the knob page"

# ── 1. The real module served a list movy could build a cell from ────────────
SEL=$(movylog | grep -oE "items selector $SELECT_KEY n=[0-9]+" | tail -1 || true)
N=$(echo "$SEL" | grep -oE "[0-9]+$" || echo 0)
{ [ -n "$SEL" ] && [ "$N" -ge 1 ]; } \
    && pass "Selector built from the device's own list ($SEL)" \
    || fail "No selector cell for $SELECT_KEY — dexed served no usable items list"

# ── 2. Scrolling loads nothing; only the release commits ─────────────────────
# A touch opens the picker, detents scroll it, the release writes once. Without
# the overlay each detent would be its own set_param — and each one loads a
# whole .syx bank.
info "Touch, scroll four detents, release..."
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
inj note_on $KNOB_NOTE 127; sleep 0.3
burst $KNOB_CC 1 4 60; sleep 0.6
MIDSET=$(movylog | grep -c "key=synth:$SELECT_KEY" || true)
[ "$MIDSET" -eq 0 ] && pass "Nothing written while scrolling (0 writes)" \
                    || fail "Scrolling wrote $MIDSET time(s) — each one loads a bank"

inj note_on $KNOB_NOTE 0; sleep 1.5
NSET=$(movylog | grep -c "key=synth:$SELECT_KEY" || true)
[ "$NSET" -eq 1 ] && pass "Release commits exactly once (n=$NSET)" \
                  || fail "Expected exactly 1 write on release; got $NSET"

# ── 3. The commit is followed by a re-read ───────────────────────────────────
# Choosing a bank resets the preset to the first of the new bank, so movy's
# cached preset count/names are stale until it re-reads the module.
sleep 1.5
AFTER=$(movylog | awk "/key=synth:$SELECT_KEY/{seen=1; next} seen && /loadHierarchy:/{print; exit}" || true)
[ -n "$AFTER" ] && pass "Module re-read after the commit: ${AFTER##*movy] }" \
                || fail "No loadHierarchy after the commit — preset list stays stale"

# ── 4. The chosen item STUCK ─────────────────────────────────────────────────
# Writing the index is not the same as the module accepting it. obxd refused
# every bank whose .fxb carried no <?xml prolog: v2_load_bank returned -1,
# v2_switch_bank left current_bank alone, and the cell snapped back to the
# first item — which reads exactly like "movy reset my bank". Steps 2 and 3
# passed throughout, because both only ever asked whether movy WROTE.
# `cur=` is the module's own read-back, taken on the re-read after the commit.
WROTE=$(movylog | grep -oE "key=synth:$SELECT_KEY val=[0-9]+" | tail -1 | grep -oE "[0-9]+$" || echo "")
BACK=$(movylog | awk "/key=synth:$SELECT_KEY/{seen=1} seen" \
       | grep -oE "items selector $SELECT_KEY n=[0-9]+ cur=[0-9]+" | tail -1 \
       | grep -oE "cur=[0-9]+" | cut -d= -f2 || echo "")
if [ -z "$WROTE" ] || [ -z "$BACK" ]; then
    fail "Could not read back the selection (wrote='$WROTE' cur='$BACK')"
elif [ "$WROTE" = "$BACK" ]; then
    pass "Selection stuck — module reports the chosen item ($SELECT_KEY=$BACK)"
else
    fail "Selection reverted: wrote $WROTE, module reports $BACK (item refused to load?)"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
    echo -e "${GRN}ALL ITEM-SELECTOR CHECKS PASSED${RST}"
else
    echo -e "${RED}$FAILURES ITEM-SELECTOR CHECK(S) FAILED${RST}"; exit 1
fi
