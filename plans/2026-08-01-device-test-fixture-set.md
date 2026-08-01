# Device Test Fixture Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every movy device test runs against one fixed, known device state and restores the user's state afterwards, so the suites are stable and independent.

**Architecture:** A sourced bash library (`scripts/lib/test-set.sh`) snapshots the live chain and movy sequencer state to an on-device backup, applies a repo-checked fixture, verifies it took, and restores on `trap ... EXIT INT TERM`. The chain half goes through the existing `scripts/module-slot.mjs` (remote-UI WebSocket, port 7700); the sequencer half is a file under `sets/<uuid>/seq-state.json`.

**Tech Stack:** bash, node (ESM, `module-slot.mjs`), ssh/scp to `ableton@move.local`, schwung remote-UI WS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-01-device-test-fixture-set-design.md`.
- Acceptance bar for every device script: passes **standalone**, in **any order**, **twice in a row**, and **honestly** (never vacuously, never a silent exit).
- **Do not modify** `../schwung-midi-inject-ui.py`, `../schwung/`, or `../schwung-davebox/` — reference only.
- **No product code changes.** This is harness work. A real product bug found here becomes a separate change.
- movy reads `seq-state.json` on open and autosaves over it every ~3 s. **All fixture and restore writes happen with movy closed.**
- Device path root: `/data/UserData/schwung`. Backup dir: `/data/UserData/schwung/_movy-test-backup`.
- Device `head`/`ls` are BusyBox: use `head -n N`, never `head -N`.
- Under `set -euo pipefail`, any `X=$(... | grep ...)` that may not match **must** end `|| true` — otherwise the script aborts at the assignment and reports nothing.
- Commit after every task. Never `git add -A`.

---

### Task 1: Chain snapshot and restore

**Files:**
- Create: `scripts/lib/test-set.sh`
- Create: `scripts/fixtures/device-set/chain.txt`
- Create: `scripts/test-fixture-selftest.sh`

**Interfaces:**
- Consumes: `scripts/module-slot.mjs get|set <slot> <component> [id]` — prints the module id currently loaded (empty string when none); `set` takes an id or the literal `none`.
- Produces: `ts_active_uuid`, `ts_chain_snapshot`, `ts_chain_apply`, `ts_chain_restore`, and the env vars `TS_BACKUP_DIR`, `TS_FIXTURE_DIR`. Later tasks call these.

- [ ] **Step 1: Write the failing selftest**

Create `scripts/test-fixture-selftest.sh`:

```bash
#!/usr/bin/env bash
# Self-test for scripts/lib/test-set.sh. The harness is test infrastructure, so
# it needs its own proof: a restore that quietly does nothing would make every
# suite look clean while leaving the user's set overwritten.
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

echo -e "${BLD}=== 1. chain snapshot/apply/restore round-trip ===${RST}"
BEFORE=$(ts_chain_read)
info "chain before: $BEFORE"
ts_chain_snapshot
ts_chain_apply
AFTER_APPLY=$(ts_chain_read)
info "chain after apply: $AFTER_APPLY"
[ "$AFTER_APPLY" != "$BEFORE" ] && pass "apply changed the chain" \
    || fail "apply did not change the chain (fixture already loaded? re-run after loading something else)"
ts_chain_restore
AFTER_RESTORE=$(ts_chain_read)
info "chain after restore: $AFTER_RESTORE"
[ "$AFTER_RESTORE" = "$BEFORE" ] && pass "restore returned the chain exactly" \
    || fail "restore drifted: '$BEFORE' -> '$AFTER_RESTORE'"

echo
if [ $fails -eq 0 ]; then echo -e "${GRN}${BLD}FIXTURE SELFTEST PASSED${RST}"; else
    echo -e "${RED}${BLD}$fails SELFTEST CHECK(S) FAILED${RST}"; exit 1; fi
```

- [ ] **Step 2: Run it to verify it fails**

Run: `chmod +x scripts/test-fixture-selftest.sh && ./scripts/test-fixture-selftest.sh`
Expected: FAIL — `scripts/lib/test-set.sh: No such file or directory`.

- [ ] **Step 3: Write the fixture chain spec**

Create `scripts/fixtures/device-set/chain.txt`. Blank lines and `#` comments ignored; fields are `slot component module`, and `none` means "empty this component".

```
# slot component module
# Track 0 melodic: plaits has a movy config (src/modules/plaits.json), so its
# knob layout is fixed — knob 5 (CC 75) is `decay`, which the automation tests
# drive. Track 1 is a drum module so watchLane >= 0 and the multi-step check
# can assert instead of skipping.
0 synth plaits
1 synth mrdrums
2 synth none
3 synth none
```

- [ ] **Step 4: Write the library**

Create `scripts/lib/test-set.sh`:

```bash
#!/usr/bin/env bash
# Shared device-test fixture state. Sourced, never executed.
#
# Device tests used to assert against whatever set the device happened to hold
# and mutated it for each other, so results depended on run order. This puts
# every run on one known state and puts the user's state back afterwards.
#
# Requires the sourcing script to define: HOST, MOVY_DIR.

TS_BACKUP_DIR=/data/UserData/schwung/_movy-test-backup
TS_FIXTURE_DIR="$MOVY_DIR/scripts/fixtures/device-set"
TS_SNAP_UUID=""

ts_ssh() { ssh "ableton@$HOST" "$@"; }

# Line 1 of active_set.txt is the set UUID; line 2 is its display name.
ts_active_uuid() { ts_ssh "head -n 1 /data/UserData/schwung/active_set.txt 2>/dev/null || true" | tr -d '\r\n'; }

# The chain as "slot:component=module" lines, one per fixture entry, so a
# snapshot and a read-back are directly comparable strings.
ts_chain_read() {
    local slot comp mod cur out=""
    while read -r slot comp mod; do
        [ -z "${slot:-}" ] && continue
        case "$slot" in \#*) continue ;; esac
        # </dev/null on every node call: without it node inherits the loop's
        # stdin and eats the rest of chain.txt, so only the first slot is read.
        cur=$(node "$MOVY_DIR/scripts/module-slot.mjs" get "$slot" "$comp" </dev/null 2>/dev/null || true)
        out="${out}${slot}:${comp}=${cur:-none}\n"
    done < "$TS_FIXTURE_DIR/chain.txt"
    printf '%b' "$out"
}

ts_chain_snapshot() {
    ts_ssh "mkdir -p $TS_BACKUP_DIR"
    ts_chain_read | ts_ssh "cat > $TS_BACKUP_DIR/chain.snapshot"
}

ts_chain_apply() {
    local slot comp mod
    while read -r slot comp mod; do
        [ -z "${slot:-}" ] && continue
        case "$slot" in \#*) continue ;; esac
        node "$MOVY_DIR/scripts/module-slot.mjs" set "$slot" "$comp" "$mod" </dev/null >/dev/null 2>&1
    done < "$TS_FIXTURE_DIR/chain.txt"
}

ts_chain_restore() {
    local line slot comp mod
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        slot="${line%%:*}"; line="${line#*:}"
        comp="${line%%=*}"; mod="${line#*=}"
        node "$MOVY_DIR/scripts/module-slot.mjs" set "$slot" "$comp" "$mod" </dev/null >/dev/null 2>&1
    done < <(ts_ssh "cat $TS_BACKUP_DIR/chain.snapshot 2>/dev/null || true")
}
```

- [ ] **Step 5: Run the selftest to verify it passes**

Run: `./scripts/test-fixture-selftest.sh`
Expected: PASS on both checks. If "apply did not change the chain" fires, the fixture was already loaded — load a different synth into slot 0 first and re-run.

- [ ] **Step 6: Prove the restore check has teeth**

Temporarily make `ts_chain_restore` return immediately (`return 0` as its first line), re-run the selftest, and confirm "restore drifted" FAILS. Then revert that line.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/test-set.sh scripts/fixtures/device-set/chain.txt scripts/test-fixture-selftest.sh
git commit -m "Snapshot, apply and restore the chain for device tests"
```

---

### Task 2: Sequencer state fixture

**Files:**
- Create: `scripts/fixtures/device-set/seq-state.json`
- Create: `scripts/fixtures/README.md`
- Modify: `scripts/lib/test-set.sh`
- Modify: `scripts/test-fixture-selftest.sh`

**Interfaces:**
- Consumes: `ts_active_uuid`, `ts_ssh`, `TS_BACKUP_DIR`, `TS_FIXTURE_DIR` from Task 1.
- Produces: `ts_seq_path`, `ts_seq_snapshot`, `ts_seq_apply`, `ts_seq_restore`, `ts_close_movy`.

- [ ] **Step 1: Write the fixture state**

Create `scripts/fixtures/device-set/seq-state.json`. This is movy's line format, not JSON despite the name (the name is fixed by `set-context.ts`). It deliberately carries **no `gen` and no `end` line**: `src/seq/persist-blob.ts:60` accepts a blob with neither as a legacy file at generation 0, so the fixture stays readable and hand-editable with no checksum to compute. A blob with `gen` but no matching trailer is treated as a torn write and rejected — so never add one without the other.

Grammar (`engine/crates/seq-core/src/persist.rs:22`): `bpm` is BPM×100; a step is 24 ticks; `cl <track> <clip> <length_steps> <loop_start> <tick:gate:pitch:vel;...>`; `au <track> <lane> <base> <label>`; `cp <track> <clip> <scale_num> <scale_den> <transpose>`.

```
movy1
bpm 12000
swing 50
link 0
tk 0 0 0
au 0 0 50 synth:decay
cl 0 0 16 0 0:24:60:100;96:24:64:100;192:24:67:100;288:24:72:100
cp 0 0 1 1 0
tk 1 0 0
cl 1 0 16 0 0:24:36:100;96:24:38:100;192:24:36:100;288:24:38:100
cp 1 0 1 1 0
tk 2 0 0
tk 3 0 0
```

Track 0's notes are C4/E4/G4/C5 on plaits. Track 1's are mrdrums pads: its config declares `padNoteStart: 36`, so 36 and 38 are the first and third pads. The `au` line pre-seeds an automation lane on `synth:decay` — plaits' knob 5 (CC 75), the knob `test-auto.sh` drives — so `test-reselect.sh` finds a lane without `test-auto.sh` having run first.

- [ ] **Step 2: Document how to regenerate it**

Create `scripts/fixtures/README.md`:

```markdown
# Device test fixtures

`device-set/` is the state every device test runs against. It is applied to
whichever Move set is active (Move's firmware owns set switching — schwung only
reacts to a SET_CHANGED flag from the shim, so the harness cannot select a set)
and the previous state is restored afterwards.

- `chain.txt` — `slot component module` per line; `none` empties a component.
- `seq-state.json` — movy's sequencer state in its line format (see
  `engine/crates/seq-core/src/persist.rs`). Despite the name it is not JSON.

## Editing seq-state.json

Edit it by hand. It must carry **neither** a `gen` nor an `end` line: a blob
with neither is accepted as a legacy file at generation 0
(`src/seq/persist-blob.ts`), while `gen` without a matching `end` trailer is
rejected as a torn write.

To start from a real save instead, play the state in on the device, close movy
so it flushes, then:

    ssh ableton@move.local 'cat /data/UserData/schwung/modules/tools/movy/sets/<uuid>/seq-state.json'

and strip the `gen` and `end` lines from what you copy in. No test regenerates
this file automatically — a test that rewrites its own fixture cannot detect
drift.
```

- [ ] **Step 3: Extend the selftest (failing)**

Append to `scripts/test-fixture-selftest.sh`, before the summary block:

```bash
echo -e "${BLD}=== 2. seq-state snapshot/apply/restore round-trip ===${RST}"
ts_close_movy
SEQ_BEFORE=$(ts_ssh "cat $(ts_seq_path) 2>/dev/null | md5sum || true")
ts_seq_snapshot
ts_seq_apply
SEQ_APPLIED=$(ts_ssh "cat $(ts_seq_path) 2>/dev/null | md5sum || true")
FIXTURE_SUM=$(md5sum < "$TS_FIXTURE_DIR/seq-state.json")
[ "${SEQ_APPLIED%% *}" = "${FIXTURE_SUM%% *}" ] && pass "fixture seq-state installed byte-for-byte" \
    || fail "installed seq-state differs from the fixture"
ts_seq_restore
SEQ_AFTER=$(ts_ssh "cat $(ts_seq_path) 2>/dev/null | md5sum || true")
[ "$SEQ_AFTER" = "$SEQ_BEFORE" ] && pass "restore returned seq-state exactly" \
    || fail "seq-state drifted across restore"
```

- [ ] **Step 4: Run it to verify it fails**

Run: `./scripts/test-fixture-selftest.sh`
Expected: FAIL — `ts_close_movy: command not found`.

- [ ] **Step 5: Implement the sequencer half**

Append to `scripts/lib/test-set.sh`:

```bash
# movy loads seq-state.json when it opens and autosaves over it every ~3 s, so
# every fixture and restore write happens with movy closed. Back x3 walks
# knobs -> chain -> exit.
ts_close_movy() {
    local i
    for i in 1 2 3; do
        python3 "$MOVY_DIR/../schwung-midi-inject-ui.py" "$HOST" cc 51 127 >/dev/null 2>&1
        sleep 0.12
        python3 "$MOVY_DIR/../schwung-midi-inject-ui.py" "$HOST" cc 51 0 >/dev/null 2>&1
        sleep 0.15
    done
    sleep 0.8
}

ts_seq_path() {
    local uuid; uuid=$(ts_active_uuid)
    echo "/data/UserData/schwung/modules/tools/movy/sets/${uuid:-_default}/seq-state.json"
}

ts_seq_snapshot() {
    TS_SNAP_UUID=$(ts_active_uuid)
    ts_ssh "mkdir -p $TS_BACKUP_DIR; echo '$TS_SNAP_UUID' > $TS_BACKUP_DIR/uuid; \
            cp '$(ts_seq_path)' $TS_BACKUP_DIR/seq-state.snapshot 2>/dev/null || \
            rm -f $TS_BACKUP_DIR/seq-state.snapshot"
}

ts_seq_apply() {
    local p; p=$(ts_seq_path)
    ts_ssh "mkdir -p \"\$(dirname '$p')\""
    scp -q "$TS_FIXTURE_DIR/seq-state.json" "ableton@$HOST:$p"
}

# Refuses to write if the active set changed since the snapshot — restoring one
# set's sequencer state into another would destroy work in both.
ts_seq_restore() {
    local now; now=$(ts_active_uuid)
    if [ -n "$TS_SNAP_UUID" ] && [ "$now" != "$TS_SNAP_UUID" ]; then
        echo "test-set: active set changed ($TS_SNAP_UUID -> $now) — NOT restoring seq-state" >&2
        return 1
    fi
    local p; p=$(ts_seq_path)
    ts_ssh "if [ -f $TS_BACKUP_DIR/seq-state.snapshot ]; then \
                cp $TS_BACKUP_DIR/seq-state.snapshot '$p'; else rm -f '$p'; fi"
}
```

- [ ] **Step 6: Run the selftest to verify it passes**

Run: `./scripts/test-fixture-selftest.sh`
Expected: PASS on all four checks.

- [ ] **Step 7: Prove movy actually loads the fixture**

Run:
```bash
ssh ableton@move.local '> /data/UserData/schwung/debug.log'
./scripts/test-seq.sh >/dev/null 2>&1 || true
ssh ableton@move.local 'grep "\[movy\] seq: loaded set" /data/UserData/schwung/debug.log | tail -n 2'
```
Expected: a `seq: loaded set <uuid>` line — movy accepted the legacy-format fixture. If instead the log shows the engine coming up empty, the fixture was rejected: re-check that it has neither a `gen` nor an `end` line.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/test-set.sh scripts/fixtures/device-set/seq-state.json scripts/fixtures/README.md scripts/test-fixture-selftest.sh
git commit -m "Add the fixture sequencer state and its snapshot/restore"
```

---

### Task 3: Verify-on-apply and crash recovery

**Files:**
- Modify: `scripts/lib/test-set.sh`
- Modify: `scripts/test-fixture-selftest.sh`

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: `test_set_begin`, `test_set_restore`, `ts_recover` — the only three names the test scripts use.

- [ ] **Step 1: Extend the selftest (failing)**

Append to `scripts/test-fixture-selftest.sh`, before the summary block:

```bash
echo -e "${BLD}=== 3. verify-on-apply fails fast ===${RST}"
# Point the fixture at a module that cannot exist: begin must abort, not run on.
TS_FIXTURE_DIR_REAL="$TS_FIXTURE_DIR"
TS_FIXTURE_DIR=$(mktemp -d)
printf '0 synth definitely-not-a-module\n' > "$TS_FIXTURE_DIR/chain.txt"
cp "$TS_FIXTURE_DIR_REAL/seq-state.json" "$TS_FIXTURE_DIR/"
if ( test_set_begin ) 2>/dev/null; then
    fail "begin accepted a fixture that never loaded"
else
    pass "begin aborted when the fixture did not take"
fi
rm -rf "$TS_FIXTURE_DIR"; TS_FIXTURE_DIR="$TS_FIXTURE_DIR_REAL"

echo -e "${BLD}=== 4. crash recovery ===${RST}"
CHAIN_BEFORE=$(ts_chain_read)
ts_chain_snapshot; ts_seq_snapshot     # simulate: snapshot taken...
ts_chain_apply                          # ...fixture applied...
ts_ssh "touch $TS_BACKUP_DIR/incomplete" # ...then the run died before restore.
ts_recover
[ "$(ts_chain_read)" = "$CHAIN_BEFORE" ] && pass "recover restored the chain after a simulated crash" \
    || fail "recover did not restore the chain"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./scripts/test-fixture-selftest.sh`
Expected: FAIL — `test_set_begin: command not found`.

- [ ] **Step 3: Implement the three public verbs**

Append to `scripts/lib/test-set.sh`:

```bash
# A run marks the backup "incomplete" until it restores. Finding that marker
# means a previous run died between apply and restore, so the user's state is
# still in the backup — recover BEFORE snapshotting, or the next snapshot
# captures the fixture as though it were the user's state and loses it for good.
ts_recover() {
    if ts_ssh "[ -f $TS_BACKUP_DIR/incomplete ]" 2>/dev/null; then
        echo "test-set: previous run left state applied — recovering first" >&2
        TS_SNAP_UUID=$(ts_ssh "cat $TS_BACKUP_DIR/uuid 2>/dev/null || true" | tr -d '\r\n')
        ts_close_movy
        ts_chain_restore
        ts_seq_restore || true
        ts_ssh "rm -f $TS_BACKUP_DIR/incomplete"
    fi
}

# Read the chain back and compare against the fixture. Never infer that an
# apply worked: silently running on the wrong state is the failure this whole
# library exists to remove.
ts_verify() {
    local want got
    want=$(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$TS_FIXTURE_DIR/chain.txt" \
           | awk '{printf "%s:%s=%s\n", $1, $2, $3}')
    got=$(ts_chain_read)
    if [ "$want" != "$got" ]; then
        echo "test-set: fixture did not take." >&2
        echo "  wanted: $(echo "$want" | tr '\n' ' ')" >&2
        echo "  got:    $(echo "$got"  | tr '\n' ' ')" >&2
        echo "  (is every fixture module installed on the device?)" >&2
        return 1
    fi
}

test_set_begin() {
    ts_recover
    ts_close_movy
    ts_chain_snapshot
    ts_seq_snapshot
    ts_ssh "touch $TS_BACKUP_DIR/incomplete"
    ts_chain_apply
    ts_seq_apply
    ts_verify || { test_set_restore; return 1; }
}

test_set_restore() {
    ts_close_movy
    ts_chain_restore
    ts_seq_restore || true
    ts_ssh "rm -f $TS_BACKUP_DIR/incomplete"
}
```

- [ ] **Step 4: Run the selftest to verify it passes**

Run: `./scripts/test-fixture-selftest.sh`
Expected: PASS on all checks in sections 1–4.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/test-set.sh scripts/test-fixture-selftest.sh
git commit -m "Fail fast when the fixture does not take, and recover from a crashed run"
```

---

### Task 4: Wire up test.sh and test-seq.sh

**Files:**
- Modify: `scripts/test.sh`
- Modify: `scripts/test-seq.sh`

**Interfaces:**
- Consumes: `test_set_begin`, `test_set_restore`.

- [ ] **Step 1: Wire both scripts**

In each script, after `HOST` and `MOVY_DIR` are defined and before the first device interaction, insert:

```bash
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
trap test_set_restore EXIT INT TERM
test_set_begin || { echo "could not establish the fixture state"; exit 1; }
```

`test-seq.sh` defines `MOVY_DIR`; confirm `test.sh` does too and add it (`MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"`) if absent.

- [ ] **Step 2: Update test.sh's slot-0 assertion**

`test.sh` currently passes with "No synth loaded — config lookup skipped (expected)". Under the fixture slot 0 always holds plaits, so replace that check with one that asserts the real thing:

```bash
echo "$LOG" | grep -q "loadHierarchy: slot=0 module=Plaits" \
    && pass "fixture synth loaded in slot 0 (Plaits)" \
    || fail "slot 0 is not the fixture synth — check the module name movy logs"
```

Run once and read the actual `loadHierarchy: slot=0 module=` line from the log to confirm the exact display name before settling on the grep.

- [ ] **Step 3: Turn multi-step into a real assertion**

In `scripts/test-seq.sh`, the drum multi-step section currently selects track 0 (`cc 43`) and skips when no lane is logged. Track 1 is the fixture's drum module, and CC 42 selects it (CC 43 = slot 0 … CC 40 = slot 3). Replace the track selection with `cc 42`, update the comment, and replace the three-branch check with:

```bash
STEP_LINES=$(echo "$LOG" | grep -c "seq: step" || true)
[[ "$STEP_LINES" -ge 2 ]] \
    && pass "Drum multi-step entered $STEP_LINES steps while one was held" \
    || fail "Multi-step entered $STEP_LINES steps (expected 2) — track 1 is the fixture's drum module, so this is a real failure"
```

- [ ] **Step 4: Run both, standalone**

Run: `./scripts/test.sh && ./scripts/test-seq.sh`
Expected: both PASS, and `test-seq.sh` now reports "Drum multi-step entered 2 steps" instead of SKIP.

- [ ] **Step 5: Run each twice in a row**

Run: `./scripts/test.sh && ./scripts/test.sh && ./scripts/test-seq.sh && ./scripts/test-seq.sh`
Expected: identical results each time. A second run that differs means restore is not returning the device to the same place.

- [ ] **Step 6: Commit**

```bash
git add scripts/test.sh scripts/test-seq.sh
git commit -m "Run test.sh and test-seq.sh against the fixture state"
```

---

### Task 5: Wire up test-auto.sh, test-reselect.sh and test-unload.sh

**Files:**
- Modify: `scripts/test-auto.sh`
- Modify: `scripts/test-reselect.sh`
- Modify: `scripts/test-unload.sh`

- [ ] **Step 1: Wire all three**

Insert the same four lines from Task 4 Step 1 into each, after `HOST`/`MOVY_DIR` and before the first device interaction. `test-unload.sh` and `test-reselect.sh` set `set -u` / `set -uo pipefail` rather than `set -e`; the snippet is unchanged.

`test-module-contract.sh` already installs `trap restore EXIT` for its FX-1 park. Do not touch that one here — Task 6 nests them.

- [ ] **Step 2: Drop test-reselect.sh's skip**

The fixture's `au 0 0 50 synth:decay` line guarantees a lane on track 0, so the "no automation lane — nothing to gate" SKIP is now a genuine failure. Replace it:

```bash
[ -n "$LANES" ] \
    && pass "fixture automation lane present on track 0 ($LANES)" \
    || fail "no automation lane on track 0 — the fixture's 'au' line did not load"
```

- [ ] **Step 3: Run all three standalone**

Run: `./scripts/test-auto.sh; ./scripts/test-reselect.sh; ./scripts/test-unload.sh`
Expected: all PASS. `test-reselect.sh` must no longer SKIP — that is the point of the fixture lane.

- [ ] **Step 4: Run them in reverse order**

Run: `./scripts/test-unload.sh; ./scripts/test-reselect.sh; ./scripts/test-auto.sh`
Expected: all PASS. Previously `test-unload.sh` deleted the clip that `test-reselect.sh` needed, so this ordering failed.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-auto.sh scripts/test-reselect.sh scripts/test-unload.sh
git commit -m "Run the automation, reselect and unload tests against the fixture state"
```

---

### Task 6: Wire up the remaining four

**Files:**
- Modify: `scripts/test-mutes.sh`
- Modify: `scripts/test-volume.sh`
- Modify: `scripts/test-module-contract.sh`
- Modify: `scripts/test-jog-hint.mjs`

- [ ] **Step 1: Wire the two simple shell scripts**

Insert the Task 4 Step 1 snippet into `test-mutes.sh` and `test-volume.sh`.

- [ ] **Step 2: Nest the traps in test-module-contract.sh**

It already has `restore()` + `trap restore EXIT` for FX 1. Keep that and have it also put the fixture back, so one trap does both in the right order (FX first, then the whole fixture):

```bash
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin || { echo "could not establish the fixture state"; exit 1; }
restore() {
    info "Restoring FX 1 to '${PREV:-<empty>}'"
    node "$MOVY_DIR/scripts/module-slot.mjs" set "$SLOT" fx1 "${PREV:-none}" >/dev/null 2>&1 || true
    test_set_restore
}
trap restore EXIT INT TERM
```

Note `PREV` is captured *after* `test_set_begin`, so it records the fixture's FX 1 (empty), not the user's — which is correct, because `test_set_restore` is what puts the user's chain back.

- [ ] **Step 3: Wire the node test**

`test-jog-hint.mjs` shells out rather than reimplementing the library, so the two paths cannot drift. Near the top, after `HOST` is resolved:

```javascript
import { execFileSync } from 'node:child_process';
const MOVY_DIR = new URL('..', import.meta.url).pathname;
const ts = (verb) => execFileSync('bash', ['-c',
    `set -u; HOST=${HOST} MOVY_DIR=${MOVY_DIR} source ${MOVY_DIR}/scripts/lib/test-set.sh; ${verb}`],
    { stdio: 'inherit' });
ts('test_set_begin');
process.on('exit', () => { try { ts('test_set_restore'); } catch {} });
```

- [ ] **Step 4: Run all four standalone**

Run: `./scripts/test-mutes.sh; ./scripts/test-volume.sh; ./scripts/test-module-contract.sh; node scripts/test-jog-hint.mjs`
Expected: all PASS. `test-volume.sh` defers one assertion on a clean log — run it twice and confirm the "slot read-back" check then runs and passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-mutes.sh scripts/test-volume.sh scripts/test-module-contract.sh scripts/test-jog-hint.mjs
git commit -m "Run the remaining device tests against the fixture state"
```

---

### Task 7: Acceptance run and documentation

**Files:**
- Create: `scripts/test-all-device.sh`
- Modify: `CLAUDE.md`
- Modify: `movy/CLAUDE.md` if the device-test section lives there rather than the root

- [ ] **Step 1: Write the runner**

Create `scripts/test-all-device.sh`, which runs every device script and summarises. Each script owns its own fixture begin/restore, so the runner only sequences them:

```bash
#!/usr/bin/env bash
# Runs every device suite. Each script establishes and restores the fixture
# itself, so any subset in any order is valid — that independence is the point.
set -uo pipefail
HOST="${1:-move.local}"
cd "$(dirname "$0")/.."
SCRIPTS=(test.sh test-seq.sh test-auto.sh test-reselect.sh test-unload.sh
         test-mutes.sh test-volume.sh test-module-contract.sh)
declare -a FAILED=()
for s in "${SCRIPTS[@]}"; do
    echo "########## $s ##########"
    ./scripts/"$s" "$HOST" || FAILED+=("$s")
done
echo "########## test-jog-hint.mjs ##########"
node scripts/test-jog-hint.mjs "$HOST" || FAILED+=("test-jog-hint.mjs")
echo
if [ ${#FAILED[@]} -eq 0 ]; then echo "ALL DEVICE SUITES PASSED"; else
    echo "FAILED: ${FAILED[*]}"; exit 1; fi
```

- [ ] **Step 2: Run the acceptance bar**

```bash
chmod +x scripts/test-all-device.sh
./scripts/test-all-device.sh                 # 1. every script, in order
./scripts/test-all-device.sh                 # 2. twice in a row
./scripts/test-unload.sh && ./scripts/test-reselect.sh && ./scripts/test.sh   # 3. shuffled subset
```
Expected: all pass every time. Any script that only passes in one ordering has not met the bar — fix it before continuing.

- [ ] **Step 3: Document it**

In the device-test section of `CLAUDE.md`, record: device tests apply `scripts/fixtures/device-set/` to the active set and restore it on exit; `./scripts/test-all-device.sh` runs everything; a crashed run self-recovers on the next run from `/data/UserData/schwung/_movy-test-backup`; and the fixture is edited by hand per `scripts/fixtures/README.md`, never regenerated by a test.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-all-device.sh CLAUDE.md
git commit -m "Add a device-suite runner and document the fixture workflow"
```

---

### Task 8 (optional): Report physical interference

Only if Tasks 1–7 are green. The suite is useful without this.

**Files:**
- Modify: `scripts/lib/test-set.sh`
- Modify: `scripts/test-fixture-selftest.sh`

- [ ] **Step 1: Establish that movy logs touches**

Run `ssh ableton@move.local 'grep -c "knobTouch\|jogTouch" /data/UserData/schwung/debug.log'` while touching a knob. If movy logs no touch line, **stop and report** — surfacing one is a product change and out of scope for this plan.

- [ ] **Step 2: Add the detector**

```bash
# Capacitive touch is the cleanest interference signal: the harness never
# injects knob-touch (notes 0-7) or jog-touch (note 9) except where a test does
# so deliberately, so an unexplained touch means a human hand on the device and
# any failure this run is suspect.
ts_touch_count() { ts_ssh "grep -c 'knobTouch\|jogTouch' /data/UserData/schwung/debug.log 2>/dev/null || echo 0" | tr -d '\r\n'; }
ts_warn_interference() {
    local after; after=$(ts_touch_count)
    if [ "${after:-0}" -gt "${TS_TOUCH_BEFORE:-0}" ]; then
        echo "test-set: WARNING — physical input detected during this run; results may be unreliable" >&2
    fi
}
```

Set `TS_TOUCH_BEFORE=$(ts_touch_count)` at the end of `test_set_begin` and call `ts_warn_interference` at the start of `test_set_restore`.

- [ ] **Step 3: Verify by touching the device mid-run**

Run any device script and touch a knob while it runs. Expected: the warning appears. Run again without touching: no warning.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/test-set.sh
git commit -m "Warn when physical input lands during a device run"
```
