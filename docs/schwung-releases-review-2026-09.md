# Schwung v0.11.4 → v1.3.3, read for movy

What changed in Schwung between 2026-06-25 and 2026-09-09 (773 commits, 12
releases), filtered for one question: **what does movy do differently
tomorrow?**

Movy's stated direction is to stop depending on Schwung-hosted modules and host
everything itself. Read that way, Schwung's last two months split into three
piles: two **latent crashes/corruptions** movy inherited by copying a contract
that has since moved; a set of **declarations modules can now make that movy
does not read**; and a small number of **capabilities already inside the binary
movy dlopens**, costing a dlsym rather than a feature.

Status tags: CONFIRMED = reproduced or read in both trees with the mechanism
identified. VERIFIED-UPSTREAM = read in Schwung, movy side checked. UNVERIFIED =
inferred from reading, not tested.

---

## 0. Where movy actually sits

`engine/crates/movy-dsp/src/chain_host.rs` dlopens **Schwung's own
`modules/chain/dsp.so`** as movy's per-track chain host, initialised against a
movy-owned copy of the host vtable. So movy is already independent of Schwung's
*four native slots* — but every per-track chain feature movy has is whatever
that binary exposes, and the binary has moved a long way since June.

That is the lens for most of this document: several things below are not
features to build, they are features already compiled into a file movy loads.

---

## 1. Fix first — two silent inheritances

### 1.1 The host vtable copy reintroduces the crash Schwung fixed — CONFIRMED

Schwung added a `void *reserved[8]` tail to `host_api_v1_t` in August
(`93837d6b`, "a NULL tail, because a module can read past the end of the
struct"). It exists because a module cannot extend the ABI from its side:
**breakbeat's shipped header appends `float (*get_project_bpm)(void)` after
`get_beat_position`** — a callback no Schwung has ever provided — and calls it
guarded:

```c
/* mestela/schwung-breakbeat @ main, src/dsp/breakbeat.c:1021 and :1686 */
if (g_host && g_host->get_project_bpm) { float bpm = g_host->get_project_bpm(); }
```

The 17 real fields end at **+120**. In Schwung, +120 is `reserved[0]` — NULL, the
guard fails, nothing happens. In movy, `chain_host.rs::shimmed_host()` leaks a
`Box<host_api_v1_t>` of movy's **17-field, 120-byte** mirror, so +120 is *past
the allocation*: whatever the allocator left there. Non-NULL passes the guard,
and the `blr` lands in the heap — SIGSEGV on the SPI callback, which takes
MoveOriginal down, and boot-loops the device if the slot is restored.

`breakbeat` is `component_type: sound_generator`, i.e. exactly what goes in a
movy chain's synth slot.

**`browser-test/abi-parity.mjs` cannot catch this and reports green.** Its C
field parser matches `ret (*name)(args);` and a trailing identifier; `void
*reserved[8];` ends in `]`, so it matches neither. The header has 18 members,
the test counts 17, movy has 17, "field count matches (17) ✓".

Fix: add `pub reserved: [*mut c_void; 8]` to `ffi.rs`, and teach the C parser
array declarators so the next tail change fails the test instead of the device.
Prove it has teeth by deleting the field and watching parity go red.

### 1.2 `PARAM_BUF` is 64 KB; Schwung's contract ceiling is now 128 KB — CONFIRMED

`45f728b8` ("param contract: 128KB, and get the 1.2MB frame off the callback
stack", #444) doubled `SHADOW_PARAM_VALUE_LEN`, with the rationale that 64 KB was
not enough for a real synth — a Waldorf microQ reaches 79% of 64 KB with 286 of
its 449 parameters, and only after dropping half of both modulation matrices.

`chain_host.rs:277` still reads:

```rust
const PARAM_BUF: usize = 64 * 1024;
```

Its own comment records what happens when this is too small: dexed's ~13.5 KB
contract read into a 4 KB buffer "truncated it mid-JSON — the module loaded (its
id is short) but every page came out wrong, which is exactly how it looked on
device."

Schwung **rejects** an over-long contract with a visible "UI buffer overflow";
movy **truncates** and plans a page set from half a JSON document. Modules are
being written against 128 KB from 1.3.0 onward, so this goes from latent to live
on the first big synth that ships.

Fix: 128 KB, and a length check that logs rather than silently parsing a
truncated read. Note the allocation is per `ChainInstance` at load time (12
chains → 1.5 MB heap, not stack), so the cost is fine.

---

## 2. Free capability — two dlsyms into a binary movy already loads

`chain_host.rs` resolves three symbols out of `dsp.so` today
(`chain_set_external_fx_mode`, `chain_process_fx`,
`chain_fx_requires_continuous`). Two more are exported now.

### 2.1 `chain_take_midi_tick_wake` — a sleeping chain drops MIDI-FX notes — UNVERIFIED (mechanism CONFIRMED)

Schwung shipped its own idle skip and then had to fix it (#436,
`chain_idle_tick.h`): when a slot is parked, the host calls `mod:tick` instead
of `render_block` so LFO and MIDI-FX timers advance. **If a MIDI FX emits a note
to the synth on such a frame, that same block must render** — otherwise the note
reaches a synth that will not be heard until the next probe.

movy's `chain_slots.rs:1051-1058` calls `inst.mod_tick()` for every chain whose
synth did not render, and **discards the result**. `ChainIdle::wake()` is driven
by MIDI arriving at the chain, which does not cover a MIDI FX generating notes
on its own — an arp, a euclidean generator, a strummed chord, anything
timer-driven. With `PROBE_PERIOD` at 172 blocks that is up to ~0.5 s of silence
after a note the sequencer never sent.

The fix is a fourth dlsym:

```c
/* chain_host.c:2870 */
int chain_take_midi_tick_wake(void *instance);  /* one-shot: render this block */
```

Call it right after `mod_tick()`; a true answer forces `work[i].synth` for that
block. Schwung's own note explains why it is self-clearing, so a host that never
calls it costs at most one skipped tick — which is the state movy is in now.

Worth writing the reproducing test first: a movy chain, an arp MIDI FX, no input
notes, assert the synth renders on the block the arp fires.

### 2.2 `chain_drain_main_send` — the chain's own post-FX send tap — VERIFIED-UPSTREAM

`chain_drain_main_send(instance, accum, n_sends, ...)` is the post-insert drain
Schwung added for its global Send A/B. movy has its own send buses
(`send_bus.rs`, three of them, with the colocation planner) and does not need
this — but it is the point at which per-voice sends become reachable, because
all three tiers sum into the same `send_accum[]`. See §4.3.

---

## 3. Declarations modules now make that movy does not read

Schwung's module contract roughly doubled (`docs/MODULES.md` 2260 → 4459 lines).
movy already reads `visible_if`, `pad_layout`, `focus_param`,
`requires_continuous_processing` and `knob_acceleration`, and honours `viz:
false` as an envelope veto. It reads none of the following.

| Declaration | What movy does today | Effort |
|---|---|---|
| `access: "read"` | **Nothing** — grep for `access` in `src/` finds only the word "accessible". A telemetry param renders as a turnable knob. Schwung fixed exactly this in 1.1.0 (#377) and gave readouts a dotted stroke; keydetect, gesture-test and 4K EQ are the affected modules. | Small |
| `short_name` | movy computes abbreviations itself (`renderer/shorten.ts`). A module that has *declared* a 5-character label is overridden by movy's guess. | Small |
| `viz: { kind, group, role }` | `param-build.ts:28` carries `viz?: unknown` and reads only the `false` case; the comment says "a `{kind: ...}` object is the module asking for a specific graphic and **is not read here**". movy infers envelope/filter/LFO/EQ instead. Schwung's resolution order is module → host override → detector, and movy has no first tier. | Medium |
| `options_as_string` | movy learns the enum wire format per key (`enumUsesIndex`, `store.ts:76`) — good, and equivalent to Schwung's `learnEnumWireFormat`. But the *declared* override is checked first upstream and never learned over. | Small |
| `child_press_param` / `focus_press_param` | Not read. This is the "a finger did that" vouch: the grid forwards Move's hardware pad note passively and writes `"1"`, so a drum module can move its own focus to the pad you **hit** without confusing it with the pattern's notes. movy has `padSelectRefresh` for Forge instead. | Medium |
| focus **change token** (`"17:snare"`) | ~~Not read.~~ **NO CONSUMER — checked 2026-09-10.** The token is an *edge detector for a reader that latches*, and movy never reads focus back: `hierarchy.ts:71` says so outright ("Deliberately NOT seeded from the DSP's currentPadParam"), and the only two sites touching `focus_param` (`drum-handler.ts`, `schwung-page.ts:386`) both WRITE it. movy's page moves from its own pad press, so re-hitting the pad you are on already works. What *was* wrong is the value movy writes — see the fix below. | — |
| `focus_param` **value shape** | **FIXED 2026-09-10.** The sibling shape's param takes a LEVEL NAME; `drum-handler.ts` wrote the pad number into it, so every declared rack was told to focus a voice called "1". `DrumConfig.padFocusValues` now carries the module's own level per pad. | Done |
| `default_fx`, `default_buses`, `preset` by name | Not read. A module can now say which FX belong behind it, and name a factory preset. Fires on interactive pick only, into an empty FX section. | Medium |
| `requires_modules` (catalog) | ~~Not read.~~ **NOT APPLICABLE — checked 2026-09-10.** It is a field on the *catalog* entry (`charlesvestal/schwung`'s `module-catalog.json`), not on anything in this repo, and it names catalog **ids** the manager installs first and then refuses to uninstall. movy has no such dependency: forge and libpo32 are optional synths movy has enhanced support for, and both docs describe a **forked build** (a PR branch carrying `pv<N>_` keys), which an id cannot name. Declaring them would force-install two synths on every movy user and pin them there. | — |
| `card_script`, `as_page`, `extra_keys`, `live: true` | Not read. See §4.1. | Large |

The `pad_layout` / voices work (#411) is the exception and it is worth saying
out loud: **Schwung wrote that contract for movy specifically.** MODULES.md names
movy as the live case and describes movy's `movy_config.json` — "fourteen
bundled configs and a four-module override list, in which
`padScoping.concreteKeyTemplate` is a verbatim re-spelling of
`child_key_template`" — as the private table it replaces. movy adopted it in
`renderer/schwung-voices.ts` + `model/drum-declared.ts`, declaration-wins /
table-as-fallback. That is the model for everything else in this table.

---

## 4. Bigger, and worth a plan

### 4.1 Modules now draw their own widgets, cards and pages

1.2.0 and 1.3.0 gave modules three drawing surfaces, all handed a **frame**
rather than the screen (`frame_ctx`, #414 — `fillRect`, `print`, `textWidth`,
`setPixel`, `line`, `fillCircle`, `drawCircle`, `drawArc`, all clipped, none
able to escape):

- **`drawCell`** — one knob box, declared as `viz: { kind: "custom:mymeter" }`,
  with `widgetKinds` for several per module, `viz.extra_keys` (cap 4) for values
  with no cell on the page, and a sprite generator
  (`tools/param-pages/widget_gen.mjs`) for lookup-style art with no JS.
- **`card_script`** — a picture that floats over the page while a knob is held,
  sized per parameter (`card_w`/`card_h`, default 96×34), handed `o.raw` (which
  **may be null**) and the whole page's `o.values`.
- **`as_page`** — a `type: "canvas"` param promoted into the level's jog
  rotation, drawn into the body band with the eight encoders still live and the
  host's chrome around it; `preset_browser: true` makes it *be* the level's
  preset browser.

Every one degrades safely on a host that has never heard of it — the built-in
widget draws. So movy is not broken by any of this. It just stops being the
better screen, on exactly the modules whose authors cared enough to draw.

`src/modules/audio_fx/widget-test/` is a working example of all three (built
only under `SCHWUNG_BUILD_TEST_MODULES=1`).

The strategic question this forces: movy's own renderer and Schwung's
`param_pages` are now diverging in *capability*, not just style, and the
capability lives on the module's side of the seam. `docs/schwung-param-pages-findings.md`
already has the 10-item "before default-on" list for the `schwunggrid` flag;
this is the argument for finishing it rather than reimplementing three drawing
surfaces in movy's renderer. Note also that 1.1.0 (#373) made the grid
**embeddable on purpose** — `movyBandLayout()` / `movyHeaderFor()` place
header / bank bar / body / footer into a rect and let a caller take any subset,
"so a tool can now keep its own chrome and host the real grid instead of writing
a second one." That is movy's exact configuration (`bands: { header: false, bank:
false, footer: false }`), now a supported API rather than a bend.

Checked: every symbol `renderer/schwung-lib.ts` imports still exists on
`origin/main`. New ones available and unused: `focusPressParamOf`, `focusToken`,
`voiceIndexFromLevel/Child/Wire`, `isHardwarePadPress`, `movyBandLayout`,
`movyHeaderFor`, `drawPadGridIcon`, `registerOverlayWidgets`, `drawCustom`.

### 4.2 Variable-length chains, as a permutation

Schwung 1.0's headline: a slot takes **8 MIDI FX and 8 audio FX** either side of
the synth, and Master FX became the same editor with 8 slots. movy exposes
`midi_fx1`, `synth`, `fx1`, `fx2` (`src/chain/config.ts:8`) and 4 master FX.

`MAX_AUDIO_FX` and `MAX_MIDI_FX` are **both 8 in `chain_internal.h`** — in the
binary movy loads. And the shape edits are three `set_param` verbs, not a
reload:

```
fx:insert = "1"     midi_fx:insert = "1"
fx:remove = "3"     midi_fx:remove = "2"
fx:move   = "1>3"   midi_fx:move   = "3>1"
```

`chain_reorder.c` shifts every per-position array together and re-aims
modulation targets, both LFOs and the knob mappings. **Instances keep running**,
so an arp keeps its phase and a reverb keeps its tail. Schwung notes thread
safety is free here because params are serviced on the SPI callback after the
mix, and nothing else touches a chain instance — which is true of movy's chains
too, with the caveat that movy renders chains on **worker lanes**, so a
permutation must not interleave with a lane render. That is the one piece of
design work; the rest is UI, persistence and the bank bar.

Worth doing early because it is mostly movy-side work over an engine capability
that already exists and is already tested upstream
(`tests/host/test_chain_permute.sh`).

### 4.3 Buses and per-voice rendering

`da640c8a` (#453) added the per-voice split render — an **optional exported
symbol**, deliberately not a vtable field, for the reason in §1.1:

```c
void move_plugin_render_split(void *instance, int16_t *const *voice_out,
                              int n_voices, int16_t *main_out, int frames);
```

plus `get_param("split_voices")` answering a flat ordered array whose **order is
the contract**. It accumulates rather than overwrites, `voice_out[]` entries
alias (two voices on one bus get the same pointer), and the host flips between
`render_split` and `render_block` **per frame** on whether any voice is bussed —
so both entry points must share voice allocator and envelope state.

Three send tiers now sum into one `send_accum[]`: the **slot** send (needs
nothing of the module — this is what makes a shared reverb reachable on an
ordinary synth), the **bus** send, and the **per-voice** send. The partition rule
is that a voice is solo-buffered iff any of its per-voice send levels is above
zero, so the sparse case is pointer-for-pointer identical to the pre-sends build
and costs nothing.

For movy this is the per-drum-voice send story — a kick going somewhere the hats
do not — on top of movy's existing three buses. Note the ownership rule Schwung
landed on: **the module owns a voice's send level**. Also `capabilities.default_buses`
lets a drum module ship its own drum bus as ordinary, reorderable, LFO-targetable
inserts.

Caveat: Schwung's slot send is drained by the *shim's* mix pass, and movy does
not use that path for its own chains. Adopting the tap means movy calling
`chain_drain_main_send` itself at the point its slot audio is finished.

### 4.4 Being a boot target — the direct path for "movy hosts everything"

`docs/BOOT_TARGETS.md` (new, #423, in 1.3.0) is the contract for a third-party
platform to be what Move boots into. `/opt/move/Move` becomes a Schwung-owned
selector showing "Loading &lt;name&gt; — press Back to change" for ~2 s, then
`exec`s a registered target. Registration is a directory:

```
/data/UserData/boot-targets/movy/
  boot.json     { "name": "Movy", "exec": ".../entry.sh", "version": ..., "author": ... }
  entry.sh
  healthy       # optional
```

The rules that matter: you run as `ableton` (ship a setuid helper via
`schwung-heal`'s staging path if you need root); you launch your own services,
including `schwung-manager` if you want the module store; you must **handle
SIGTERM** (a TERM-deaf binary keeps `/dev/ablspi0.0` open and the next start
finds the device busy — black screen only `kill -9` clears); the LED surface
arrives dark; never write to `/tmp`; never touch `/opt/move/Move`,
`MoveOriginal`, `schwung-shim.so` or `ld.so.preload`. A three-strike watchdog
means a target can never boot-loop the device, and touching `healthy` after tens
of seconds of real work is the better opt-in than the liveness fallback.

Also relevant: `capabilities.standalone` for a tool that is a whole program
(`launch-standalone.sh` restarts Move when it exits), and the staged-helper path
for a tool needing one privileged step of its own.

This does not have to be a fork. It is the supported way for movy to stop being
an overtake tool without leaving the Schwung ecosystem — the module store, the
chain host binary and the param_pages library all remain available to a target
that launches them.

### 4.5 Module loading is still on the audio thread — in both trees

Schwung 1.0's own known-issues list: "Module loading blocks the SPI callback —
measured at 673 ms, roughly 232 dropped frames, device-wide rather than
per-slot. The design to fix it is written up and its blocking question has been
answered (no plugin calls the dangerous host callbacks during
`create_instance`), but the work is not done."

movy's `load_queue.rs` says the same thing in its own words — it bounds the
damage to one load per callback and states plainly that it "deliberately does
NOT make loading cheap… If that ever proves unacceptable the answer is to move
loads off the audio thread entirely, which needs a handshake around chain state
that has no locking."

**A reference implementation now exists in the binary movy loads.** `chain_bus.c`
loads an audio FX in a **bus insert** position on a SCHED_OTHER bus worker,
cores 0-2: its `dlopen`, `create_instance`, `destroy_instance` and the
state-restoring `set_param` run there, while `process_block`, `on_midi` and every
live `set_param`/`get_param` stay on the callback. `plugin_api_v1.h` documents
the consequence for module authors — the same module can be constructed on the
worker for a bus and on the callback for a slot **at the same time**, so
process-global init must be thread-safe.

If movy wants off-thread loading, that handshake (and its release/acquire
publish) is the shape to copy, and the fleet has already been told the rule.

### 4.6 Worth replicating: snapshot and recall

1.2.0's <kbd>Shift</kbd>+<kbd>Copy</kbd> saves a snapshot of the set's
parameters and <kbd>Shift</kbd>+<kbd>Delete</kbd> brings it back, with recall
**quantized to the next beat, bar or 2 bars** (Global Settings → Shortcuts →
*Recall Q*) so the revert lands in time. The snapshot belongs to the set and
re-seeds on load.

movy has undo/redo and 32-version set history, which are *editing* tools. This
is a *performance* tool — mangle everything, drop back on the bar — and movy is
better placed to do it than Schwung, because movy owns every parameter of 12+
tracks and already has a beat clock to quantize against. Note also that Schwung
reserves Shift+Copy / Shift+Delete as host-owned **even over a module that
claims those CCs**, which is a deliberate signal about where the gesture lives.

Also in 1.2.0/1.3.0 and worth a look for movy: per-slot **stems** rendering
(one file per slot, Song Mode renders them too), and a Move→Schwung
**metronome** that plays on speakers only and never into a recording.

---

## 5. Resolved upstream — stale movy notes to retire

- **The power button under overtake is fixed.** `9e0814c6` (#292, Aug 27,
  authored from this account) — the overtake filter's blanket `status >= 0x80 →
  suppress` was zeroing the lead packet of the power button's cable-0 SysEx, and
  cable 14 was being forwarded to modules where `0x3A` collided with Move's Loop
  CC. `465a5f1d` (#322, Aug 28) then fixed the follow-up it named: the shutdown
  prompt now **parks** the overtake tool via the existing suspend path instead of
  tearing it down, so Back leaves something resumable. `movy/docs/schwung-poweroff-overtake-fix.md`
  and the corresponding memory are now history, not a handoff.
- **Enum knobs that wrote the wrong value** (1.1.0 #376, `formatParamForSet`
  matching option *text* before reading an index — 40 params across the fleet).
  movy's write path is independent and already learns the convention, so this is
  informational: if a module *padded its option text* to work around #376, that
  workaround is coming out and movy will see the change.
- **External encoders** (1.2.0): Schwung's relative-CC decoder read only ±1.
  movy decodes through Schwung's shared `decodeDelta`, which was already correct,
  and uses the magnitude — no action.

## 6. Already aligned — no action

`bulk_get_param`/`bulk_set_param` (adopted, 110→145 Hz),
`get_beat_position` (mirrored and used for chain LFO lock),
`requires_continuous_processing` (honoured in `chain_idle.rs`),
`shadow_set_overtake_suppress_master_volume`, `shadow_overtake_move_inject_active`,
`suspend_self_managed` / `host_suspend_overtake` (background mode),
`visible_if`, `pad_layout` / voices / `focus_param`, enum wire-format learning,
chain knob CC 102-109.

Both trees independently shipped a silent-chain idle skip and a parallel/threaded
render story in the same window; §2.1 is the one place Schwung's version learned
something movy's has not.

---

## 7. Suggested order

**Items 1-4 are DONE (2026-09-10) — see the CHANGELOG's Unreleased section.**
Two of the four §3 rows resolved differently than this document expected, and
the table above records why: the focus change token has no consumer in movy
(movy writes focus, never reads it — but it was writing the wrong *value*, which
is fixed), and `requires_modules` is a catalog field naming a dependency movy
does not have.

1. ~~§1.1 `reserved[8]` + a parity test that can see array members.~~ **DONE.**
2. ~~§1.2 `PARAM_BUF` 128 KB + overflow log.~~ **DONE** — the overflow log was
   already there (`chain_host.rs:310`); a drift test against
   `SHADOW_PARAM_VALUE_LEN` was not.
3. ~~§2.1 `chain_take_midi_tick_wake`.~~ **DONE.** The wake decision lives in
   `chain_idle.rs::midi_tick_wake` so it is unit-testable without a chain host;
   `mod_tick` is `#[must_use]`, because discarding its answer IS the bug.
4. ~~§3 the small column.~~ **DONE** — `access` (both directions) and
   `short_name`; see the table for the other two rows.
5. §4.2 variable-length chains. Biggest user-visible win per unit of new
   engine risk, because the engine part already exists.
6. §4.1 finish the `schwunggrid` PAGE-mode list, or accept the divergence
   deliberately and write down why.
7. §4.4 boot target — the one that actually moves the strategy, and the one to
   scope properly rather than start.

## 8. Not verified

- §2.1 is reasoned from both sources, not reproduced. Write the arp-on-a-sleeping-chain
  test before the fix.
- Whether a movy lane render can interleave with a chain permutation (§4.2) —
  Schwung's "thread safety is free" argument does not transfer unexamined.
- Nothing in §4 was measured for cost on movy's frame budget.
