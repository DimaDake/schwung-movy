# SP-36 — the automation channel: the missing mark, and the arc that must not jump

**Ledger:** `docs/schwung-page-migration.md` → SP-36. Read that first; this file
is the working plan, the ledger entry is the record.

## What was asked

Two halves of one complaint, both about a parameter movy is automating:

- **(a)** under `off` an automated parameter wears a 2×2 dot next to its label
  (`renderer/label.ts`, `pvm.automated`); under `page` nothing marks it, so the
  page cannot tell you what the sequencer is driving.
- **(b)** while the transport plays, an automated parameter's knob **jumps** —
  the pointer chases the lane. The ask: the pointer should **stay where you set
  it**, with the automation showing as a mark moving across the knob, *"like
  with lfo"*.

## The two decisions the entry left open, and how they were settled

Both were put to the user on 2026-09-19 and answered:

1. **Does `off` change too?** — **No.** `page` only for now; movy's own renderer
   keeps following the lane until SP-30 flips the default. The divergence is
   deliberate and is recorded in the ledger rather than left to be discovered.
2. **Which mark?** — **the tilde now, SU-8 filed.** Automated keys are reported
   through `isModulated`, which is what buys the whole (b) reading; the
   dot-vs-tilde distinction becomes an upstream per-cell channel (SU-8), not a
   second mark movy paints into Schwung's cell.

## The mechanism, and why nothing upstream had to change

Schwung's controller already draws exactly what (b) asks for, for any key movy
reports as modulated: the **pointer** takes `<key>:base` and a five-pixel plus
**rides the arc** at `<key>:effective` (`page_controller.mjs`
`refreshModulatedValues`, `render_page_movy.mjs` `drawModDot`). Both reads come
back to movy's own injected io, so movy owns both answers.

**The base was the whole item.** The engine emits the lane's value as a CC and
the chain applies it inside the DSP (`movy-dsp/src/lib.rs`, `OutEvent::Cc`), so
a read of the plain key answers *the lane* — there is no second value to read.
But the base is not lost: movy already tells the engine about it, once per edit,
in the `abase`/`abaseq` it sends (`seq/automation.ts`), and the engine keeps it
as `lane_base`.

## The build

| piece | file |
| --- | --- |
| the base, mirrored where movy already sends it | `src/seq/automation-base.ts` (new) |
| the mirror's writes, beside each `abase`/`abaseq` | `src/seq/automation.ts` |
| the engine's own read-back, for a restored Set | `engine/…/seq-core/src/engine.rs` `auto_bases()`, `movy-dsp` key `abases` |
| the seed, on the same sync that rebuilds the registry | `src/app/tick.ts` |
| what the page may ask about lanes | `src/app/automated-keys.ts` (new), `src/types/page-automation.ts` (new) |
| the three answers | `src/renderer/schwung-page-io.ts` |
| the frame the moving mark needs | `src/renderer/schwung-page-render.ts` (`knobLevels`) |

`ENGINE_VERSION` 0.79.0 → **0.80.0** (both halves; `build-dsp.sh` fails if they
diverge).

## Teeth (each measured, `browser-test/logic/page-automation.mjs`)

| removed | what reddens |
| --- | --- |
| the `isModulated` widening | no mark at all, and the pointer chases the lane |
| the `:base` answer | pointer `0.90` / `0.10` where `0.5` was dialled — the reported bug, reproduced |
| `knobLevels`' live value | the levels go flat: the mark is drawn once and freezes |
| the `:effective` answer | **39 wasted port round trips across 40 ticks**, against 0 |

The `:effective` answer is a READ optimisation, not the dot — the controller
falls back to the plain key, so the dot appears either way. Measured and
recorded, because the obvious "simplification" is to delete it.

## What was deliberately not done

- **`off` is untouched** (decision 1). One scene, one renderer, no baseline moved.
- **No new screenshot baseline.** No rendering logic changed: the widget and its
  mark are Schwung's, already pinned by `page_mod_cell`, and what movy supplies
  is the three values the logic suite asserts directly.
- **`:effective` is NOT widened to every modulated key.** Since schwung #276 a
  chain-modulation target's plain key answers the BASE, so answering
  `:effective` with the plain read there would park the dot on the pointer.
