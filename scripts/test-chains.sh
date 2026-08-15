#!/usr/bin/env bash
# test-chains.sh — movy hosts its own schwung chains (Stage 3 foundation).
#
# The first device exercise of chain hosting. It checks SAFETY before features,
# because the failure mode here is not "a test fails" — it is MoveOriginal dying
# and taking the device's audio with it:
#
#   1. movy still sequences its four schwung tracks (chain hosting must degrade,
#      never break what already worked)
#   2. the chain host loaded, or said clearly why not
#   3. the tick rate did not collapse
#   4. MoveOriginal is still alive
#
# Loading a module INTO a movy chain is not exercised here: nothing in the UI
# can address `ch<N>:` yet (that is Stage 4). This deliberately tests the
# foundation rather than pretending to test the feature.
#
# Usage: ./scripts/test-chains.sh [move.local]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
MOVY_DIR="$(pwd)"
# Sourced for qgrep: `grep -q` under pipefail reports 141 on a FOUND line once
# the piped log outgrows the pipe buffer, so a passing check reads as a failure.
# The fixture helpers are not used here — this test wants a plain boot.
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"

LOG=/data/UserData/schwung/debug.log
PASS=0; FAIL=0
GRN=$'\033[0;32m'; RED=$'\033[0;31m'; BLD=$'\033[1m'; RST=$'\033[0m'
pass() { echo "${GRN}✓${RST} $1"; PASS=$((PASS+1)); }
fail() { echo "${RED}✗${RST} $1"; FAIL=$((FAIL+1)); }

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || {
    echo "DEVICE OFFLINE — SKIPPING CHAIN TEST"; exit 0
}

echo "${BLD}=== deploying ===${RST}"
./scripts/deploy.sh "$HOST" >/dev/null 2>&1 || { echo "deploy failed"; exit 1; }

ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on; > /data/UserData/schwung/debug.log'

echo "${BLD}=== opening movy ===${RST}"
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
cmd = json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"})
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(cmd)
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0)
    mm[56] = 1
    mm.close()
"'
sleep 8

LOGTXT=$(ssh "ableton@$HOST" "cat $LOG")

echo
echo "${BLD}=== Results ===${RST}"

# 1. The property that must never regress.
if echo "$LOGTXT" | qgrep "seq: engine ready"; then
    pass "engine still boots with chain hosting compiled in"
else
    fail "engine did not boot — chain hosting broke the sequencer"
fi

# 2. Chain host outcome. Loaded is the goal; a clear refusal is acceptable
#    (movy degrades). SILENCE is the real failure: it means the UI never sent
#    chain_host, or the DSP never handled it.
if echo "$LOGTXT" | qgrep "chain host loaded from"; then
    pass "chain host dlopened: $(echo "$LOGTXT" | grep -o 'chain host loaded from.*' | head -1)"
elif echo "$LOGTXT" | qgrep "chain hosting unavailable"; then
    fail "chain host refused: $(echo "$LOGTXT" | grep -o 'chain hosting unavailable.*' | head -1)"
elif echo "$LOGTXT" | qgrep "chain host copy failed"; then
    fail "copy failed: $(echo "$LOGTXT" | grep -o 'chain host copy failed.*' | head -1)"
else
    fail "no chain-host log line at all — chain_host param never reached the DSP"
fi

# 3. The private copy exists and is distinct from schwung's (separate inode is
#    the whole point — a shared mapping would clobber schwung's g_host).
SRC_INO=$(ssh "ableton@$HOST" 'stat -c %i /data/UserData/schwung/modules/chain/dsp.so 2>/dev/null || echo x')
CPY_INO=$(ssh "ableton@$HOST" 'stat -c %i /data/UserData/schwung/modules/tools/movy/chain-dsp.so 2>/dev/null || echo y')
if [ "$CPY_INO" != "y" ] && [ "$SRC_INO" != "$CPY_INO" ]; then
    pass "private chain-host copy exists with its own inode"
else
    fail "no distinct private copy (src=$SRC_INO copy=$CPY_INO)"
fi

# 4. Load a module INTO a movy chain and confirm it is serviced. Driven through
#    the UI's own port by selecting track 5 (the first movy track) and opening
#    the module browser is a Stage-4 gesture; here the load is issued directly
#    over the remote-UI websocket to the engine's ch0 namespace, which is the
#    same path the port uses.
echo "${BLD}=== loading a module into movy chain 0 (track 5) ===${RST}"
node scripts/engine-param.mjs set "ch0:synth:module" plaits "$HOST" >/dev/null 2>&1
sleep 3
LOGTXT=$(ssh "ableton@$HOST" "cat $LOG")

# The engine logs each serviced load. That is the only external evidence
# available: the remote-UI socket can write an engine param but has no read
# verb, so there is nothing to poll.
if echo "$LOGTXT" | qgrep "chain 0: synth = plaits"; then
    pass "movy chain 0 created and loaded plaits"
else
    fail "no 'chain 0: synth = plaits' in the log — the load never reached the queue or was never serviced"
fi

# A second load into the same slot must reuse the instance, not leak one.
node scripts/engine-param.mjs set "ch0:synth:module" wurl "$HOST" >/dev/null 2>&1
sleep 3
LOGTXT=$(ssh "ableton@$HOST" "cat $LOG")
if echo "$LOGTXT" | qgrep "chain 0: synth = wurl"; then
    pass "chain 0 swapped module without a reload of the host"
else
    fail "second load into chain 0 did not appear in the log"
fi

if echo "$LOGTXT" | qgrep "chain hosting unavailable"; then
    fail "chain hosting dropped out during the loads"
else
    pass "chain hosting stayed up across loads"
fi

# 5. Tick rate — chain rendering runs every block.
RATE=$(echo "$LOGTXT" | grep -o 'perf_tick_rate=[0-9]*' | tail -1 | cut -d= -f2)
if [ -n "$RATE" ] && [ "$RATE" -ge 60 ]; then
    pass "tick rate ${RATE}/s >= 60"
else
    fail "tick rate ${RATE:-unknown}/s below threshold"
fi

# 6. Nothing crashed. Last, because it is the check that matters most and
#    reads best at the bottom.
if ssh "ableton@$HOST" 'pgrep -f MoveOriginal >/dev/null 2>&1'; then
    pass "MoveOriginal is alive"
else
    fail "MoveOriginal DIED — recover with the davebox restart sequence"
fi

echo
echo "Restarting the Move stack (movy owns the LEDs while open)..."
ssh "ableton@$HOST" 'systemctl --user restart move-launcher 2>/dev/null || true' >/dev/null 2>&1

if [ "$FAIL" -eq 0 ]; then
    echo "${GRN}${BLD}CHAIN DEVICE TEST PASSED${RST} ($PASS checks)"
else
    echo "${RED}${BLD}$FAIL CHECK(S) FAILED${RST}"
    exit 1
fi
