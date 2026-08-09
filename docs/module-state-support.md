# Module `state` support — what's missing, and what it costs

A Schwung chain module is expected to expose its whole configuration through one
param:

```c
get_param("state")   ->  every setting, as one string
set_param("state", s)->  restore them all
```

Nine of the 35 sound generators installed on this device don't provide a usable
one. This documents what breaks, which modules are affected, and what each needs.

**Scanned 2026-08-09** on `move.local`, by loading each module and reading
`<component>:state` from inside Movy.

---

## Why it matters

### 1. Settings are lost when a Set is reopened

This is the serious one, and it has nothing to do with Movy.

Schwung saves a chain slot in `buildSlotPatchJson` (`shadow_ui.js:4247`). It
starts from `cfg.synth.params`, then replaces it with the state blob:

```js
let synthConfig = cfg.synth.params || {};
const stateJson = getSlotStateWithRetry(slotIndex, "synth:state");
if (stateJson) synthConfig = { state: state };
```

`cfg.synth.params` is initialised to `{}` and **never written to** for a track
slot — the only two writers in the file are on the master-FX path
(`shadow_ui.js:4750`, `:4761`). So when `synth:state` comes back empty, the
saved patch contains no parameters at all. Schwung's own comment says so:

> *"it also blocks legitimate saves when the user swaps to a module that doesn't
> implement `get_param("state")` at all … save with whatever we have (possibly
> empty) so the module selection survives a reboot."*

**The module selection survives a restart. Its settings do not.**

A module whose state is present but whose *parser* is wrong fails differently
and more quietly: the blob saves and reloads, but comes back scrambled. That was
`weird-dreams` — its deserializer read one field more than its serializer wrote,
so every field after the master block landed one slot out and the instrument
reloaded silent. Fixed in
[filliformes/weird-dreams-move#2](https://github.com/filliformes/weird-dreams-move/pull/2).

### 2. Movy's undo captures slowly

Undo snapshots a module before any change that rewrites it wholesale — a preset,
a bank or ROM selector, a randomiser. With a JSON state blob that is one read.
Without one, Movy falls back to reading every published parameter individually,
at 3–5 ms each on device:

| | Surge XT (302 params) |
|---|---|
| Reading each param | **884 ms**, in a single tick |
| Parsing the state blob | **18 ms** |

Both are measured on device. The fallback is correct — it is tested, and it is
what lets Movy repair a module that cannot parse its own state — but on a
200-param module the first turn of a preset knob visibly stalls.

---

## What a module needs to provide

1. **`get_param("state")` returns every setting.** Not just what the UI shows —
   anything the module keeps and would want back.
2. **`set_param("state", s)` restores exactly what the getter wrote.** The two
   must agree field for field; a single extra or missing read shifts everything
   after it (this is the `weird-dreams` bug).
3. **Prefer JSON: `{"key": value, ...}`.** Any non-empty string is accepted and
   persisted — Schwung stores an unrecognised blob verbatim — but JSON is worth
   the small effort:
   - Schwung's remote UI can flatten it into individual params
     (`remote_ui.go` `fetchAllParams`), which is how the web UI shows a module's
     values at all.
   - Movy reads values from it directly instead of polling each param, which is
     the 884 ms → 18 ms above.
   - Writing the values back individually bypasses the module's own parser, so a
     parser bug like `weird-dreams`' is corrected rather than inherited.

A round-trip test is worth having in the module itself: serialize, deserialize,
serialize again, and assert the two strings match. That single test would have
caught the `weird-dreams` bug before release.

---

## Affected modules

### No usable state — settings lost on Set reload

| Module | Params | State read | Work needed |
|---|---:|---|---|
| `forge` | 193 | absent | Implement `get_param`/`set_param("state")`. Largest exposure here: 193 params, all lost on reload. |
| `osirus` | 156 | 0 bytes | Implement, or find why it returns empty. Note the ROM/bank selectors must be restored **before** the preset index, or the preset addresses the wrong bank. |
| `chordism` | 135 | 0 bytes | Implement, or find why it returns empty. |
| `linein` | 20 | absent | Probably fine to leave — a line input has little worth persisting. Confirm and close. |

> **Caveat on `osirus` and `chordism`:** the 0-byte reading was taken as the
> module's hierarchy loaded. Both may populate their state later — `osirus`
> loads a ROM asynchronously. Worth re-reading after a full load before treating
> the state as genuinely absent.

### State present but not JSON — persists, but slow to capture

These reload correctly (assuming their parser is right — see `weird-dreams`).
Converting them to JSON is a performance and tooling improvement, not a
correctness fix.

| Module | Params | State size | Approx. capture cost today |
|---|---:|---:|---|
| `weird-dreams` | 219 | 1067 B | ~880 ms |
| `signal` | 146 | 2012 B | ~580 ms |
| `aphex` | 83 | 1396 B | ~330 ms |
| `essaim` | 34 | 3171 B | ~140 ms |
| `wurl` | 11 | 91 B | negligible |

### Working — JSON state

`303`, `breakbeat`, `chiptune`, `dexed`, `freak`, `hera`, `hush1`, `minijv`,
`moog`, `mrdrums`, `mrsample`, `nusaw`, `obxd`, `plaits`, `po32-drum`, `sf2`,
`sfz`, `surge`.

`minijv` (418 params, 12 KB blob) and `surge` (302 params, 6.8 KB) show the
approach scales.

---

## A separate finding: Schwung's remote UI can't read large blobs

During the scan, Schwung's remote-UI WebSocket reported **zero** parameters for
`surge` while Movy read its 6864-byte blob in-process without trouble. Whatever
size limit applies to `shm.GetParam` in `schwung-manager`, it is below what the
larger modules produce.

Consequence: the web UI likely cannot show parameters for the most
parameter-dense modules. This is a Schwung issue, unrelated to the module work
above, and worth raising separately.

---

## How to verify a fix

No Set reload or reboot needed:

1. Load the module on track 0 and set some parameters to distinctive values.
2. Turn a preset knob (or fire a randomiser) once, then press **Undo**.
3. Read the log:
   ```
   ssh ableton@move.local 'grep "\[movy\] undo:" /data/UserData/schwung/debug.log'
   ```

What the lines mean:

| Line | Meaning |
|---|---|
| `restored <comp> state (N bytes)` | The blob is being used — the module has one. |
| `dumped N params … from state` | Values came from the blob — it parsed as JSON. |
| `dumped N params … 884 ms` | No usable blob; every param was read individually. |
| `verify rewrote N param(s)` | The restore did not hold; the module's own parser is rewriting them. `N` should be 0. |

A module that is fully working shows `restored … state`, a `from state` dump in
the tens of milliseconds, and no `verify rewrote` line.
