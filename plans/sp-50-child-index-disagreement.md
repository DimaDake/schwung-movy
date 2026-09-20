# SP-50 — movy and the controller disagree about which child is showing

Ledger entry: `docs/schwung-page-migration.md` lines 1266-1333. Order **7.8**,
a release gate. Related reading done for this plan: lines 99-195 (state
tables), lines 3262-3313 (environment facts), lines 2700-2788 (SP-20,
`ui_hierarchy` ownership — the "one reader" rule this plan does not touch).

**This plan does not touch `../schwung`.** Where a genuinely correct fix would
require the reference module `voice-poc` to declare something it does not
today, that is named as an upstream note and the movy-side plan stops short of
it.

---

## 1. The controller's resolution rule vs movy's, side by side

Both sides were re-read against `origin/main` (`git -C ../schwung fetch --all`,
then `git -C ../schwung show origin/main:src/shared/param_pages/page_controller.mjs`
and `.../child_key.mjs` — the local `../schwung` checkout is not on `main`, so
line numbers below are from the fetched `origin/main` blob, not the checkout on
disk, and will drift from the ledger's own citations, which were taken at a
different commit. The **logic** is identical; only line numbers moved).

**The controller (`page_controller.mjs`, fetched blob):**

- `childIndexFor(level)` (line 885): `s.childIndex[level]` if it is a number
  `>= 0`, **else 0**. This is the single read every draw and every key
  resolution goes through (`childResolve`/`fullKey`, line 917-921;
  `pageLabel`, line 945-965).
- The only two writers of `s.childIndex[level]`:
  - `syncChildIndexFromModule(p)` (line 1823): reads
    `childIndexParam(p.childLevel)` — **if the level declares none, it returns
    at line 1826 (`if (!idxParam) return;`) without writing anything.**
  - `syncVoiceFromModule()`'s local-adopt branch (line ~2114): reached only
    through the hierarchy's top-level `focus_param`, and only for a voice whose
    resolved index came back non-null from `voiceIndexFromLevel`/
    `voiceIndexFromWire` (`voices.mjs`). `voiceIndexFromLevel` explicitly
    requires `v.childIndex === null` — it **skips every child-level voice** —
    so this branch can only ever be reached if the module publishes a
    **numeric flat voice index** on `focus_param`, never a level name.
  - `liveChildIndex(def, level)` (line ~4184), used only by the copy/clear
    instance gesture, has the same `if (!idxParam) return childIndexFor(level)`
    shape.
- **Rule, stated once:** a child level's focused instance is `s.childIndex[level]`,
  and the *only* channel that ever moves it is `<prefix>:<child_index_param>`
  (or, for the sibling shape, a *numeric* `focus_param` reading — never a level
  name, and never reachable for a child-level voice via the documented
  contract; see `schwung/docs/MODULES.md` lines 2123-2150, table: `focus_param`
  → "a level name"). No push channel of any kind exists otherwise.

**movy (`src/renderer/schwung-page-input.ts`):**

- `focusVoice(pad)` (line 151-199): resolves the pressed pad to a `Voice` via
  `surfaceOf(hierarchy)` (`src/renderer/schwung-voices.ts`), then:
  - line 173-174: `if (cip) port.setParam(qualify(cip), String(v.childIndex))`
    — writes the child-index channel **only when the level declares one**.
  - line 176: `if (s.focusParam) port.setParam(qualify(s.focusParam), v.level)`
    — writes the **level name** (never a number) to the sibling-shape channel,
    which (per the controller rule above) can never resolve to a specific
    child-level instance, only to a level that IS one whole voice
    (`childIndex === null`).
  - `jump(i, v.childIndex)` (called from both branches) then warms the arriving
    page's cells using **movy's own** `v.childIndex` (line 74-77,
    `concrete()`), regardless of whether anything upstream is capable of
    moving there.

**The precise divergence:** movy always *knows* which child it is showing
(`v.childIndex`, computed locally from `voicesOf()`), and always *attempts* one
of the two write channels — but where the level declares no
`child_index_param`, **no channel movy can drive actually reaches
`s.childIndex[level]`** (the sibling-shape write is the wrong wire format for a
child-level voice, confirmed by reading `voiceIndexFromLevel`/
`voiceIndexFromWire`). `childIndexFor` then answers 0 (or whatever a prior
instance-picker pick left it at) forever, on every subsequent read, draw and
label — while movy's own bookkeeping (and the SP-39 warm) proceeds as though
the press succeeded.

---

## 2. Which half is which, and a fix for each

### Half (a) — missing `child_index_param`: controller resolves instance 0, movy addresses none

**This is the live, fleet-reachable half** (voice-poc's `pads` level, the
installed fixture — verified directly against
`docs/module-dump/device-dump.json`'s `voice-poc` entry: `pads` declares
`child_count: 4`, `child_note_base: 48`, `child_names`, **no**
`child_index_param`). `voicesOf()` on that hierarchy orders voices
`kick(0) snare(1) hat(2) TomLo(3,childIndex0) TomHi(4,childIndex1) Rim(5,childIndex2) Clap(6,childIndex3)`
— `reverb` contributes no voice (no note). So `focusVoice(5)` presses "Tom Hi"
(`childIndex=1`).

- `cip` (line 173) is falsy → **no write happens at all** on the
  `child_index_param` channel (there is none to write).
- The sibling-shape write (line 176, `s.focusParam` = `"cur_voice"`, since
  voice-poc *does* declare a top-level `focus_param`) writes the string
  `"pads"` — the level name. The controller's `syncVoiceFromModule` reads it
  back, calls `voiceIndexFromLevel(voices, "pads")` (fails — every "pads"
  voice has `childIndex !== null`), falls to `voiceIndexFromWire(voices,
  "pads")` (`Number("pads")` is `NaN` → null), and bails at
  `if (vi === null) return`. **This channel cannot disambiguate a child-level
  instance under the documented contract — writing a number instead would
  work by reading the code, but only a numeric `focus_param` reading is
  accepted anywhere, which is not the documented shape (`docs/MODULES.md`:
  "a level name") and is worth flagging upstream rather than exploited
  locally — see the note at the end of this section.**
- Result: `childIndexFor('pads')` stays at whatever it already was (0 on a
  fresh page) for every subsequent read **regardless of which of the 4 pads is
  pressed**. `jump(i, 1)`'s `concrete()` (schwung-page-input.ts:74-77) warms
  `p2_vol` (childIndex 1, `child_index_base: 1` → `formatIndex` = 2) — a key
  the controller will **never** read, because it is drawing at
  `childIndexFor('pads') = 0` → `p1_vol`. The warm is not merely wasted; it
  actively misses the key that will actually be read, so the first read of
  `p1_vol` still pays the single round trip SP-39 exists to avoid.

**Fix, movy-only, no upstream dependency.** The controller already exports
exactly the oracle this needs: `ctl.childIndexOf(level)` (fetched blob,
line ~5470 — `"Which instance of `level` is focused, zero-based. The editor
hand-off needs it: without it the editor re-asks which child, when the grid
already knows."`). Change `jump`'s `concrete()`
(`src/renderer/schwung-page-input.ts:74-77`) to warm at the index the
controller will *actually* resolve to when there is no channel to move it,
instead of at the voice movy locally computed:

```ts
const concrete = (k: string): string => {
    if (!p.childLevel || typeof lib.resolveChildKey !== 'function') return k;
    const cip = (p.childLevel as any).child_index_param;
    const at = cip
        ? childIndex                                   // movy is about to MOVE this — optimistic, settles on the controller's own next poll (existing behaviour, unchanged)
        : (typeof ctl.childIndexOf === 'function' ? ctl.childIndexOf(p.level) : 0);
    return (typeof at === 'number') ? (lib.resolveChildKey(p.childLevel, at, k) || k) : k;
};
```

Guard `ctl.childIndexOf` as optional (`typeof ... === 'function'`, falling back
to 0 — matching `childIndexFor`'s own default) the same way `resolveChildKey`
is guarded elsewhere in this file, in case a Schwung at the stated floor
(`1.3.0`) predates the export. **This does not make the grid follow the
pressed pad** (that is genuinely impossible without a channel — see the
closes-when text's own wording, "movy and the controller agree", not "the
press moves the controller"). It makes movy stop lying to itself: the warm
targets the cell that will really be drawn, and the header/label question
raised in the Product paragraph collapses to "the controller's chosen child
never moves for this level," which is a true, if less exciting, description —
worth restating precisely rather than assuming the Product paragraph's "header
says the child the user hit" is literally true. (`pageLabel()`,
`page_controller.mjs` line 945-965, ALSO reads `childIndexFor`, not anything
movy writes — so under the current code the header is not actually chasing
the pressed pad either; it is a separate, smaller finding worth a one-line note
in the ledger's Corrections style rather than a fix of its own here.)

**Upstream note, not part of this plan's implementation:** the reference
module `voice-poc`'s `pads` level could declare `child_index_param` (the way
`sophie`'s does) and the existing, already-correct `child_index_param` machinery
would close the loop for real. That is a change to `../schwung`'s own example
module, so it is an ask, not a patch — record as **SU-15** if the maintainer
wants it filed, since installing the fixed `voice-poc` is the only way to get
real coverage of the fully-working case (the one sophie almost provides, but
without a note map — see half (a)'s sibling problem below).

### Half (b) — the off-by-base on the wire value

**Real, and has NO fleet exhibition** — confirmed independently: the only
module in 95 dumps that declares `child_index_param` is `sophie`
(`docs/module-dump/modules/sound_generator--sophie.json`,
`child_index_base: 1`, `child_index_param: "focused_pad"`), and it declares no
`child_note_base`/`child_notes` on either of its two child levels — so
`voicesOf()` returns **zero voices** for sophie (verified: `childNote()`
returns null without a note map, so `voicesForLevel` pushes nothing). `focusVoice`
bails at its `if (!hierarchy || !v) return false` guard before it ever reaches
the write. No dumped module has both a `child_index_param` **and** a note map
on the same level, which is exactly the combination the bug needs.

- **Cause** (`src/renderer/schwung-page-input.ts:173-174`):
  `port.setParam(qualify(cip), String(v.childIndex))` writes a **zero-based**
  instance. Schwung's own converter,
  `childIndexToWire(level, i)` (`child_key.mjs`, `return String((i|0) +
  indexBase(level))`), adds `child_index_base` before the value reaches the
  wire; `childIndexFromWire` subtracts it back on the way in. movy's write
  skips the addition, so on a level declaring `child_index_base: 1` (as both
  `sophie` and `voice-poc`'s `pads` do) the controller would read the write as
  instance `v.childIndex - 1` — one below the one movy pressed, permanently
  (not the transient miss the neighbouring comment describes).
- **Fix.** Route the write through the same converter Schwung already applies
  on the read side, rather than restating the arithmetic. Add
  `childIndexToWire` to the one door
  (`src/renderer/schwung-lib.ts`'s `SchwungLib` interface and the
  `ck.childIndexToWire` destructure/assignment, alongside `resolveChildKey`,
  which is from the same `child_key.mjs` import and already optional-guarded)
  and change the write:

  ```ts
  if (cip) {
      const wire = typeof lib.childIndexToWire === 'function'
          ? lib.childIndexToWire(lvl, v.childIndex)
          : String(v.childIndex);   // pre-existing behaviour on an older Schwung
      port.setParam(qualify(cip), wire);
  }
  ```

  `childIndexToWire` has existed in `child_key.mjs` since the file's own
  introduction (it is the pairing half of `childIndexFromWire`, which
  `syncChildIndexFromModule`/`liveChildIndex` already rely on for the read
  path) — no floor bump needed, but guard it exactly as `resolveChildKey` is
  guarded, since correctness here should not depend on grepping the exact
  version this landed in.

- **Do not invent fleet coverage for this.** No dumped module exercises it, and
  a `dump-replay.mjs` invariant runs against real dumps only — this half is
  tested with a **synthetic** hierarchy fixture (see §4), which costs exactly
  the fidelity the briefing warns about: it proves the arithmetic, not that
  any shipping module hits it.

---

## 3. Scope: behind `page` only, and `off` untouched

Both fixes live entirely inside `src/renderer/schwung-page-input.ts` and
`src/renderer/schwung-lib.ts`. `createPageInput` (the file under (a)/(b)) is
constructed exactly once, in `src/renderer/schwung-page.ts:146`
(`const input = createPageInput(ctl, lib, port, qualify, hier, cache.warm)`),
inside the module that exists ONLY when `schwungGridMode() === 'page'`
(`src/renderer/schwung-grid.ts`'s three-value mode, `off | body | page`) — the
whole `SchwungPage` object this file backs is never constructed under `off`.
So there is no `off`-reachable call site to regress by construction, not by
convention: nothing needs to be special-cased for the flag, because the flag
already gates the file's only caller. Verify this holds (rather than trusting
the argument) by running `SCHWUNG=../schwung node browser-test/page-mode.mjs`
before and after — the "N of M expected failures" count must not move, and the
`off` arm of every `browser-test/app-loop.mjs` scene must stay byte-identical
(the existing screenshot baselines already assert this for the `off` arm; if
none currently exercises `voice-poc` under `off`, that is expected — this
module has no config-translated bank fallback and `off` never reaches
`focusVoice` on it either way).

---

## 4. Test with teeth, cheapest level first

### Half (a) — `dump-replay`-adjacent: real device metadata, no device

No existing browser-test file exercises this branch at all:
`grep -rn "resolveChildKey\|childLevel" browser-test/` returns nothing (still
true after this investigation), and `browser-test/logic/schwung-page-press.mjs`
(100 lines, SP-39's own file, the natural home — same subject, same module
family, well under the ~600-line ceiling) drives `focusVoice(8)` only through
`6w6`'s config-translated, non-child path.

Add a case to `browser-test/logic/schwung-page-press.mjs` built on
`dumpFixture('voice-poc')` (`browser-test/dump-fixture.mjs`, already used
elsewhere for real-device-shaped fixtures — this is exactly "the strongest
option because it runs against the real device metadata" the briefing asks
for):

1. `env.setParams(dumpFixture('voice-poc'))`, `schwungPageFor(0, 'synth')`,
   tick to ready (mirrors the existing `jumpFrom()` helper in the same file).
2. **Pin the fixture's shape first**, so a future dump update that adds
   `child_index_param` to `pads` doesn't silently make the rest of the test
   meaningless: assert the parsed hierarchy's `levels.pads.child_index_param`
   is falsy. (If this ever goes red, the whole item is moot and should be
   closed as fixed-by-the-fixture, not patched around.)
3. Wrap `globalThis.shadow_get_params` around `p.focusVoice(5)` (pad 5 = "Tom
   Hi", `childIndex = 1` — worked out from `voicesOf`'s declared order: kick,
   snare, hat, reverb (no voice, no note), then the 4 `pads` children) the same
   way `countTripKinds` does in `harness.mjs`, but capture the **keys**
   requested, not just a count.
4. Assert, with the fix applied:
   - `p.ctl.pages[p.pageIndex].level === 'pads'` (navigation still lands on the
     right page — unaffected by this fix).
   - `p.ctl.childIndexOf('pads') === 0` (the controller genuinely never moved —
     this is the ledger's stated, unfixable-without-upstream half; asserting it
     is what stops a future "fix" from silently papering over the missing
     channel with a fabricated write).
   - the warmed keys include `synth:p1_vol` (childIndex 0's concrete key —
     `child_index_base: 1` → `formatIndex(0) = 1`) — **not**
     `synth:p2_vol` (childIndex 1, the pressed instance).
5. **Teeth**: with the fix reverted (the old `concrete()` using `v.childIndex`
   unconditionally), step 4's third assertion goes red — the warm covers
   `p2_vol`, never `p1_vol` — while the first two stay green, which is exactly
   the "looks navigated, isn't" shape the Product paragraph describes.

### Half (b) — synthetic fixture, named cost

No fleet module can pin this (§2). Cheapest level: a hand-built hierarchy
object in the same test file, declaring one child level with both
`child_index_param` **and** a note map, `child_index_base: 1` (so 0 and 1 are
distinguishable from the bug):

```json
{
  "pad_layout": "drums",
  "levels": {
    "root": { "params": [{ "level": "pads", "label": "Pads" }] },
    "pads": {
      "child_count": 2, "child_key_template": "p{index}_{key}",
      "child_index_base": 1, "child_index_param": "focused_pad",
      "child_note_base": 60, "knobs": ["vol"]
    }
  }
}
```

Spy on the mock `TrackPort`'s `setParam` (the same port `portFor(0)` other
suites in this directory already spy on — see `page-freshness.mjs`), call
`focusVoice(2)` (voice index 1, `childIndex = 1`, "instance 2" by name), and
assert the write is `setParam('synth:focused_pad', '2')` — `childIndexToWire`
adding the base — not `'1'`.

**Teeth**: with the fix reverted (`String(v.childIndex)`), the assertion goes
red — the write is `'1'`, one below what a `child_index_base: 1` level expects
back.

**What this costs in fidelity, stated plainly**: this fixture is not attested
against any real module's declared shape — it proves the arithmetic
(`childIndexToWire` is applied, and applied with the right level/index), not
that a shipping module round-trips it correctly through a real `set_param`/
`get_param` pair. That gap can only close when a fleet module declares both
`child_index_param` and a note map on one level (§2's SU-15 note, if
`voice-poc` gains one, would double as this).

---

## 5. Ordered steps for implementation

1. **Re-fetch and re-read**, in case this plan sits before it is picked up:
   `git -C ../schwung fetch --all`, then re-diff the three cited functions
   (`childIndexFor`, `syncChildIndexFromModule`, `childIndexOf`,
   `childIndexToWire`) against `origin/main` — line numbers in this plan will
   have moved even if nothing material changed, and `../schwung` is a
   reference checkout only (never edit it).
2. **`schwung-lib.ts`**: add `childIndexOf` is NOT needed here (it lives on
   `ctl`, not on the `lib` namespace — no import wiring required for half a).
   Add `childIndexToWire?: any;` to the `SchwungLib` interface, next to
   `resolveChildKey` (same file, same `child_key.mjs` import, same optional
   contract), destructure `ck.childIndexToWire` alongside `ck.resolveChildKey`
   in the `Promise.all` result, and add `childIndexToWire: ck.childIndexToWire`
   to the `lib = { ... }` object. The file is at 195/200 lines — this addition
   is ~3 lines; if it tips over 200, trim rather than split (the header docblock
   already explains why `resolveChildKey`/`childPressParam` etc. are optional;
   a one-clause addition to that shared sentence covers this one too, instead
   of a new paragraph).
3. **`schwung-page-input.ts`**: this file is at 199/200 lines — already at the
   hard limit. Both fixes touch it, so the large comment above `concrete()`
   (lines 50-73, which currently narrates the SP-39/SP-50 history) must be
   **rewritten to describe the new behaviour**, not appended to — once the fix
   lands, "the keys warmed are the WRONG child's... carried as SP-39's ledger
   NOTE and opened as SP-50" is stale. A shorter comment stating the new rule
   (warm at `childIndex` when the level owns a channel to get there, else warm
   at `ctl.childIndexOf(level)` because that is what will actually be read)
   should net this file back under 200, not over it.
   - Implement the `concrete()` change from §2, half (a).
   - Implement the `cip` write change from §2, half (b).
4. **Tests**: add both cases to `browser-test/logic/schwung-page-press.mjs`
   per §4. Run with the fix, confirm green; revert each fix in turn, confirm
   the matching assertion (and only that one) goes red; reapply.
5. **Gates**: `SCHWUNG=../schwung npm test` (0 failures),
   `SCHWUNG=../schwung node browser-test/page-mode.mjs` (count must not grow —
   expect it unchanged at whatever it currently reads, since neither fix
   touches a planned page shape). No `engine/` change, so no `cargo test`. No
   rendering change (the fix is entirely in what gets warmed/written, not
   drawn), so no screenshot re-baseline expected — run
   `node browser-test/screenshot.mjs` anyway to confirm 0 diffs rather than
   assume it.
6. **Ledger update**: mark SP-50 done in `docs/schwung-page-migration.md`'s
   state table, and record in the entry itself: half (a) fixed movy-side
   (warm/read agreement, not pad-follow — that needs upstream); half (b) fixed
   movy-side and pinned only by a synthetic fixture, named as such. If the
   maintainer wants the `voice-poc` upstream ask filed, add it as **SU-15**
   in the Upstream table with the exact ask: "`pads` level to declare
   `child_index_param`, matching `sophie`'s, so the already-correct
   `child_index_param` machinery closes the loop for a shipping example."
7. **Commit**: `src/renderer/schwung-lib.ts`, `src/renderer/schwung-page-input.ts`,
   `browser-test/logic/schwung-page-press.mjs`,
   `docs/schwung-page-migration.md` — never `git add -A`.

Device tier: not required by this item specifically (no MIDI routing, IPC
shape, or display change — the fix changes which cache keys get warmed and
what value gets written to a param no fleet module reads on the installed
set), but it runs anyway at the wave boundary per the standing rule.
