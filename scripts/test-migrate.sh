#!/usr/bin/env bash
# test-migrate.sh — tracks 1-4 come out of schwung's slots and into movy's
# chains, once per set.
#
# The local suite (browser-test/logic/track-migrate.mjs) proves the migration's
# RULES against mock params. This proves the two things it cannot: that the
# keys the migration reads are keys a REAL schwung still answers under those
# exact spellings, and that a migrated track arrives with the PATCH the user
# had rather than the module's factory defaults.
#
# Four arms. The first is the answer to "what about a future schwung change":
# without it, a renamed key makes the migration quietly find nothing, and every
# arm below would still pass on a set with nothing to migrate.
set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export HOST
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin
trap test_set_end EXIT INT TERM

PASS=0; FAIL=0
ok()  { echo -e "  \033[0;32m✓\033[0m $1"; PASS=$((PASS+1)); }
bad() { echo -e "  \033[0;31m✗\033[0m $1"; FAIL=$((FAIL+1)); }

clear_log() { ts_ssh '> /data/UserData/schwung/debug.log' 2>/dev/null || true; }
mig_log()   { ts_ssh 'grep -E "\[movy\] mig:" /data/UserData/schwung/debug.log 2>/dev/null || true'; }

# ── Arm 1: the contract canary ──────────────────────────────────────────────
# EVERY key the migration reads, off a slot the fixture really seeded. When
# schwung renames or drops one, this says WHICH — without it the migration
# quietly finds nothing and the other three arms still pass on an empty set.
echo "── contract: the keys the migration depends on ──"
SYNTH=$(ts_read_slot 0 || true)
if [ -z "$SYNTH" ]; then
    bad "slot 0 holds no synth — the fixture did not seed, nothing below is valid"
    echo; echo -e "\033[0;31m\033[1m$((FAIL)) CHECK(S) FAILED\033[0m"; exit 1
fi
ok "slot 0 synth reads back ($SYNTH)"
# slot:volume checked directly — it round-trips over the remote-UI subscribe
# channel (see scripts/slot-param.mjs). synth:state does not: verified on
# device, that key is assembled only for the shim's own internal callers and
# never broadcasts here. The positive arm below is its canary instead — a
# renamed synth:state fails there distinctly (a migrated chain with no preset
# blob), which is the same "name what broke" guarantee, just one arm later.
val=$(ts_slot_param 0 "slot:volume" || true)
if [ -z "$val" ]; then bad "schwung no longer answers 'slot:volume' — the migration reads it"
else ok "'slot:volume' answers ($val)"; fi

# ── Seed the LEGACY layout: schwung holds the patch, movy has never claimed
#    tracks 0/1 as chains. The standard fixture's own ui-state.json already
#    lists chains 0/1 (so every OTHER suite opening it is a no-op migration —
#    the tracks are already occupied), so this arm needs its own blob. ──────
UUID=$(ts_active_uuid)
[ -n "$UUID" ] || { echo "test-migrate: no active set" >&2; exit 1; }
D="/data/UserData/schwung/modules/tools/movy/sets/$UUID"
LEGACY='{"root":48,"rootPc":0,"scale":0,"mode":0,"layout":0,"oct":[4,4,4,4],"mutes":{"solo":[0,0,0,0],"base":null},"flags":{"chtrackset":0}}'

echo "── positive: a legacy set adopts the schwung rack ──"
ts_close_movy
ts_ssh "printf '%s' '$LEGACY' > $D/ui-state.json" \
    || ts_ssh_root "printf '%s' '$LEGACY' > $D/ui-state.json" \
    || { echo "test-migrate: could not write the legacy blob" >&2; exit 1; }
clear_log
ts_open_movy
sleep 12   # splash + probe + settle, well past the ~1.5 s the probe itself needs

LOG=$(mig_log)
echo "$LOG" | sed 's/^/    /'
if echo "$LOG" | qgrep "mig: migrated [12] track"; then
    ok "the migration ran and found tracks to adopt"
else
    bad "no 'migrated' line in the log"
fi

# chloadedlog is the ONLY movy-chain read-back (see CLAUDE.md). ts_chloaded
# pokes it and waits for the poke's OWN reply line — write-to-read, so reading
# whatever the log already held would describe a chain from before this.
CHAINS=$(ts_chloaded || true)
echo "    $CHAINS"
if echo "$CHAINS" | qgrep "0:synth=plaits"; then ok "chain 0 holds the adopted synth (plaits)"
else bad "chain 0 does not show plaits loaded"; fi

# Audibility, not a module id: the migration carries the whole preset blob, so
# the saved set's chain component should carry the fixture's DISTINCTIVE param
# value (plaits' engine choice), not the module's factory default. A module id
# alone proves a load, not a patch.
UI_NOW=$(ts_ssh "cat $D/ui-state.json 2>/dev/null || true")
if echo "$UI_NOW" | qgrep '"engine":"VA VCF"' || echo "$UI_NOW" | qgrep 'VA VCF'; then
    ok "the migrated chain carries the fixture's own patch, not factory defaults"
else
    bad "the saved chain does not carry the fixture's distinctive param value"
fi

if echo "$UI_NOW" | qgrep '"migv":1' ; then ok "the set is marked migrated (migv)"
else bad "the set was not marked migrated"; fi
if echo "$UI_NOW" | qgrep '"chains"'; then ok "the saved set carries a chains array"
else bad "no chains array in the saved set"; fi

# The schwung slot is never cleared — a migration that emptied it would be
# data loss, not a restore.
STILL=$(ts_read_slot 0 || true)
if [ "$STILL" = "$SYNTH" ]; then ok "the schwung slot is untouched ($STILL)"
else bad "the schwung slot changed: was $SYNTH, now $STILL"; fi

# ── Arm 3: negative control + idempotence ───────────────────────────────────
echo "── negative control: a migrated set does not re-migrate ──"
ts_close_movy
clear_log
ts_open_movy
sleep 8
LOG2=$(mig_log)
if [ -z "$LOG2" ]; then ok "a re-open of a migrated set logs nothing"
else bad "a migrated set probed again: $LOG2"; fi

echo "── nothing to migrate reads as nothing, not as a failure ──"
ts_close_movy
for slot in 0 1 2 3; do
    node "$MOVY_DIR/scripts/slot-state.mjs" clear "$slot" >/dev/null 2>&1 || true
done
ts_ssh "printf '%s' '$LEGACY' > $D/ui-state.json" \
    || ts_ssh_root "printf '%s' '$LEGACY' > $D/ui-state.json" || true
clear_log
ts_open_movy
sleep 8
LOG3=$(mig_log)
echo "$LOG3" | sed 's/^/    /'
if echo "$LOG3" | qgrep "mig: nothing to migrate"; then ok "an empty rack reads as nothing to migrate"
else bad "no 'nothing to migrate' line for an empty rack"; fi

# Restore the fixture's own chain for the manual-row arm below.
ts_close_movy
node "$MOVY_DIR/scripts/slot-state.mjs" module 0 plaits >/dev/null 2>&1 || true
node "$MOVY_DIR/scripts/slot-state.mjs" load 0 "$MOVY_DIR/scripts/fixtures/device-set/slot_0.json" >/dev/null 2>&1 || true
ts_ssh "printf '%s' '$LEGACY' > $D/ui-state.json" \
    || ts_ssh_root "printf '%s' '$LEGACY' > $D/ui-state.json" || true
clear_log
ts_open_movy
sleep 12

# ── Arm 4: the manual Settings row ──────────────────────────────────────────
echo "── MIGRATE TRACKS: the manual row re-runs it and overwrites ──"
# Shift+Step 2 opens Settings (STEP_FLAGS = 1, so note 16 + 1).
ts_send "0x0B:0xB0:49:127:0.08" "0x09:0x90:17:127:0.08" \
        "0x08:0x80:17:0:0.08"   "0x0B:0xB0:49:0:0.3"
# Jog to the CLAMPED last row — the last action row, MIGRATE TRACKS, whatever
# the flag count is.
JOGS=()
for _ in $(seq 1 40); do JOGS+=("0x0B:0xB0:14:1:0.02"); done
ts_send "${JOGS[@]}"
sleep 0.5
clear_log
ts_send "0x0B:0xB0:3:127:0.15" "0x0B:0xB0:3:0:0.4"   # arm
ts_send "0x0B:0xB0:3:127:0.15" "0x0B:0xB0:3:0:0"     # confirm
sleep 12   # save + reload + splash + probe

LOG4=$(mig_log)
echo "$LOG4" | sed 's/^/    /'
if echo "$LOG4" | qgrep "mig: manual"; then ok "the manual row ran the migration"
else bad "no 'manual' line — the row press did not reach the migration"; fi

echo
echo "$PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
    echo -e "\033[0;32m\033[1mALL $PASS CHECKS PASSED\033[0m"
else
    echo -e "\033[0;31m\033[1m$FAIL CHECK(S) FAILED\033[0m"; exit 1
fi
