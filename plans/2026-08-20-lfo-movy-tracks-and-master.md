# LFO on movy tracks, and an LFO page for the master chain

Date: 2026-08-20

Two defects, one shared cause and one shared refactor.

1. **LFO mapping does nothing on tracks 5-16.** Assigning a target writes
   nothing at all, so no modulation follows.
2. **The master chain has no LFO page**, although the shim has had two working
   master LFOs all along.

---

## Part A — the assign bug

### Root cause

`src/lfo/assign.ts:19` commits the three target fields through
`shadow_set_param_timeout(track, …)` — schwung's **slot**-addressed API — rather
than through the track's port:

```js
if (typeof shadow_set_param_timeout === 'function') shadow_set_param_timeout(track, key, val, 100);
else portFor(track).setParam(key, val);
```

`js_shadow_set_param_timeout` (schwung `src/shadow/shadow_ui.c:1112`) starts:

```c
if (slot < 0 || slot >= SHADOW_UI_SLOTS) return JS_FALSE;   /* SHADOW_UI_SLOTS == 4 */
```

A movy track is not a schwung slot — it is a chain inside movy's own engine,
addressed `ch<N>:…`. So on tracks 5-16 the call returns false having written
nothing, and because the function *exists* the `else` branch never runs. Neither
the hold-a-knob gesture nor the LFO page's TARGET overlay assigns anything;
`enabled` stays 0, so the chain's `lfo_tick()` skips the LFO entirely.

Reproduced locally (track 5, faithful stub):

```
ch0:lfo1:target       = (unwritten)
ch0:lfo1:enabled      = (unwritten)
TARGET cell shows     = Syn:cutoff      ← optimistic local mirror; nothing was written
```

Everything else on the page (rate, shape, depth, phase…) already goes through
`portFor(track)` and does reach the chain — which is why the failure looked
partial. The engine side needs no work: movy's chains are real schwung chain
instances and `chain_host.c` runs `lfo_tick()` inside every `render_block`.

`src/undo/module-apply.ts:209` has the identical defect on the undo path —
restoring an LFO assignment on a movy track is silently dropped.

### Fix

Both sites go through the port:

```js
portFor(track).setParamTimeout(key, val, 100);
```

`HostSlotPort.setParamTimeout` *is* today's call, so tracks 1-4 are unchanged bit
for bit; `MovyChainPort.setParamTimeout` is a blocking `ch<N>:` engine write.

### Why no test caught it

`browser-test`'s `shadow_set_param_timeout` stub ignores its slot argument and
writes into a flat store, so a slot-addressed write to track 12 "succeeded" in
every test. The stub gets the device's guard (`slot >= 4` → return false, write
nothing). That is the change with the teeth: without it no test can see this
class of bug, of which we have now found two instances.

---

## Part B — master LFO page

The shim already implements two master LFOs (`shadow_chain_mgmt.c`):
keys `master_fx:lfo1:*` / `master_fx:lfo2:*`, targets `fx1`-`fx4` and the other
LFO, ticked by `shadow_master_fx_lfo_tick()`. Schwung persists them by reading
`master_fx:lfoN:config` **from the shim** at save time, so — unlike master FX
module loads (schwung-movy#9) — a movy-side edit persists with no mirror hack.

Movy just has no page. `MASTER_FX_SLOTS` holds four module slots and no LFO.

### The refactor that makes it cheap

`createLfoModel`, `assign.ts`, `assign-mode.ts` and `buildTargetOptions` all take
a bare `track: number` today. They take an `LfoScope`:

```ts
interface LfoScope {
    port:         TrackPort;   // where the lfoN:* keys live
    keyPrefix:    string;      // '' for a track, 'master_fx:' for master
    undoLabel:    string;      // 'T7' | 'MASTER'
    components:   string[];    // ['synth','fx1','fx2','midi_fx1','midi_fx2'] | ['fx1'..'fx4']
    hasRetrigger: boolean;
}
```

Two constructors, `trackScope(n)` and `masterScope()`. The waveform preview,
target overlay, sync phase-lock and hold-to-assign then work on both unchanged.

`src/lfo/model.ts` is 294 lines — over the 200-line hard limit before any of this
lands. It splits while we are in it, by responsibility rather than by line count:

- `src/lfo/scope.ts` — `LfoScope`, `trackScope`, `masterScope` (87)
- `src/lfo/io.ts`    — reading/writing one LFO's values through a port (49)
- `src/lfo/cells.ts` — what the page looks like: cells + `buildLfoVM` (125)
- `src/lfo/inert.ts` — the Model surface a page with no module doesn't have (45)
- `src/lfo/model.ts` — state and knob gestures alone (175)

### Wiring

- `MASTER_FX_SLOTS` gains a 5th virtual slot (`LFO`), plus `isMasterLfoSlot()`.
- Master grid clamp `Math.min(3, …)` → `MASTER_FX_SLOTS.length - 1`
  (`src/midi/router.ts:548,615`).
- Jog-click on the LFO slot drills to detail instead of opening a module
  browser; jog hint reads `CLICK JOG: EDIT LFOS`.
- Hold-to-assign works from master FX param pages: the held knob's component
  (`master_fx:fx1`) maps to the `fx1` the shim expects by stripping `keyPrefix`.
- Knob 7 (RETRIG) is `null` on the master page — a blank cell with its LED off.
  The master bus has no notes and the shim has no `retrigger` key; drawing a
  dead knob would read as broken.

### Latent bug this fixes

`renderChainView` hardcodes `CHAIN_SLOTS.length` for the bank bar, so the master
chain draws **five dots for four slots** today. It takes the slot count as a
parameter; with the new LFO slot both chains are five and honest.

---

## Part C — movy-track LFO persistence

`chain-persist.ts` skips the LFO slot ("no module of its own"), and the LFO lives
in the chain instance rather than in any component's `:state` blob. So a movy
track's LFO settings are lost on every close — the mapping would work until you
leave.

The 20 `lfoN:*` keys fold into the bulk read `captureChains` **already** does per
track, so this costs zero extra round trips; restore writes them with one
`setMany`. Skipped entirely when both LFOs are disabled with no target, so a set
that uses no LFOs costs nothing. Written after the modules: a target only binds
once its module is present.

Host tracks need none of this — Move's own set file carries a schwung slot's LFOs.

---

## Tests

| Level | Covers |
| --- | --- |
| `browser-test/env.mjs` | faithful `shadow_set_param_timeout` slot guard (the teeth) |
| `logic.mjs` | assign lands on `ch0:lfo1:*` for a movy track; undo LFO restore likewise; scope construction; master target list; master cells (knob 7 null, no retrigger write) |
| `logic.mjs` | Part C save/restore round trip, and the "no LFO use → nothing written" skip |
| `app-loop.mjs` | master chain nav reaches slot 4, jog-click drills instead of browsing, knobs edit the master LFO |
| `screenshot.mjs` | master LFO page baseline |
| `scripts/test-lfo.sh` | THE claim, on device: an LFO assigned on a movy chain moves the driven param. Needs the real chain DSP, so no local test can show it — asserted by sampling the driven param repeatedly through the new `chlfolog` engine diagnostic |
| device | `test.sh`, `test-seq.sh` |

Prove the teeth: with the fix reverted, the movy-track assign test must fail.

---

## Docs

`MANUAL.md` — the LFO section notes the master chain's LFO page and its
differences (no retrigger, FX-slot targets). `README.md` — no headline change.
