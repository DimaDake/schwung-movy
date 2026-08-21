#!/usr/bin/env bash
# Self-test for scripts/lib/test-set.sh. The harness is test infrastructure, so
# it needs its own proof: an apply that quietly did nothing would make every
# suite look clean while the tests ran on whatever the device happened to hold.
set -uo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GRN='\033[0;32m'; RED='\033[0;31m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'
fails=0
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; fails=$((fails+1)); }
info() { echo -e "${YLW}→${RST} $1"; }

# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"

echo -e "${BLD}=== 1. a clean apply reaches the fixture state ===${RST}"
if test_set_begin; then pass "test_set_begin established the fixture"; else fail "test_set_begin failed"; fi

echo -e "${BLD}=== 2. apply recovers from a perturbed slot ===${RST}"
# Drag slot 0 somewhere else, exactly as a test that loads its own module does.
info "perturbing slot 0 -> noisemaker"
node "$MOVY_DIR/scripts/slot-state.mjs" module 0 noisemaker </dev/null >/dev/null 2>&1
sleep 6
PERTURBED=$(ts_read_slot 0)
info "slot 0 is now '${PERTURBED:-<empty>}'"
if [ "$PERTURBED" = "noisemaker" ]; then
    pass "perturbation took (so the recovery below is a real test)"
else
    fail "could not perturb slot 0 — the next check would pass without proving anything"
fi
if test_set_begin; then pass "apply restored the fixture after perturbation"; else fail "apply did not recover the fixture"; fi

echo -e "${BLD}=== 3. apply is idempotent ===${RST}"
if test_set_begin; then pass "second apply is a no-op that still verifies"; else fail "re-applying an already-correct fixture failed"; fi

echo -e "${BLD}=== 4. verify rejects a fixture that did not take ===${RST}"
# Point the fixture at a module that cannot exist: verify must refuse it.
TS_FIXTURE_REAL="$TS_FIXTURE_DIR"
TS_FIXTURE_DIR=$(mktemp -d)
printf '0 definitely-not-a-module\n' > "$TS_FIXTURE_DIR/slots.txt"
cp "$TS_FIXTURE_REAL/slot_0.json" "$TS_FIXTURE_DIR/slot_0.json"
if ts_verify 2>/dev/null; then
    fail "verify accepted a slot that does not hold the fixture module"
else
    pass "verify rejected a slot that does not hold the fixture module"
fi
rm -rf "$TS_FIXTURE_DIR"; TS_FIXTURE_DIR="$TS_FIXTURE_REAL"

echo -e "${BLD}=== 5. closing movy actually closes it ===${RST}"
# ts_close_movy is the load-bearing step of every apply above: the fixture is
# written to a file a running movy autosaves over, so a close that quietly does
# nothing leaves suites running on movy's own state instead. It did exactly that
# for weeks — Back x3 walked knobs → chain → *open the Leave-Movy modal* → cancel
# it, which exits nothing.
#
# Asserted on the overtake byte rather than on the fixture surviving afterwards:
# movy only writes when its state actually changed (set-session.ts, saveNeeded),
# so an idle movy leaves the file alone whether it is running or not, and that
# check passes just as happily with the broken close. This one does not.
ts_open_movy
sleep 4
if ts_overtake_active; then
    pass "movy is open (so the close below is a real test)"
else
    fail "could not open movy — the checks below would pass without proving anything"
fi
if ts_close_movy; then pass "ts_close_movy reported the surface handed back"
else fail "ts_close_movy could not close movy"; fi
if ts_overtake_active; then
    fail "overtake still owns the surface — movy did not exit"
else
    pass "overtake is off, so movy genuinely exited"
fi

echo
if [ $fails -eq 0 ]; then echo -e "${GRN}${BLD}FIXTURE SELFTEST PASSED${RST}"; else
    echo -e "${RED}${BLD}$fails SELFTEST CHECK(S) FAILED${RST}"; exit 1; fi
