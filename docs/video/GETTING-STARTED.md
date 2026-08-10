# Getting started with Movy

Came here from the video? This is the short version. Two installs, no terminal.

---

## 1. Install Schwung on your Move

**Movy is not a standalone thing** — it is a tool that runs *inside* Schwung, the
community framework that lets an Ableton Move run custom synths, drums and
effects. Install that first.

→ **[Schwung — installation instructions](https://github.com/charlesvestal/schwung#readme)**

Follow that README to the point where you can open Schwung's web UI in a browser
and see your Move's tracks. Everything below assumes you're there.

Schwung's own documentation is the authority on installing it, what a host
version is, and what to do when the Move doesn't come back — this page
deliberately doesn't copy any of it, because a stale copy is worse than a link.

## 2. Install Movy from the Schwung module store

In Schwung's web UI, open the **module store** and install:

- **Movy** — the tool itself
- **At least one sound generator** — you need something to play. The video uses
  [Mr Drums](https://github.com/handcraftedcc/schwung-mrdrums),
  [Weird Dreams](https://github.com/filliformes/weird-dreams-move), OB-Xd and Helm.

Movy is in the public catalog, so it installs like any other module — no
building, no SSH, no cloning this repo.

## 3. Open it

On the Move: **Schwung's Tools menu → Movy**.

You'll land on the **chain view** — four empty track slots. Jog-click one to open
the module browser and load a synth or drum module into it. That's the first
gesture in the video, and everything else follows from it.

---

## Then what?

**[📖 The full manual](../../MANUAL.md)** — every gesture, every page, every
shortcut. It's long because Movy does a lot; the contents list at the top is the
fastest way in.

The five things worth trying first, in the order the video does them:

| Try this | How |
| --- | --- |
| Load a drum module | Jog-click an empty slot |
| Give it sounds | See below — a sampler module loads empty |
| Step-record a fast part | Hold **Rec** while stopped, play the pads |
| Make a loop stop repeating | **Hold a step** → set PROB and COND |
| Keep your timing instead of losing it | **Shift + Step 3** → turn QUANT down |
| Modulate anything | **Hold a knob** ~1 s → pick an LFO → jog-click |

### Does this change my Move?

**Move's own instruments keep working.** Schwung runs alongside Move's software
rather than replacing it, so Drift, Wavetable, your drum racks and your existing
Sets are all still there. Movy can even keep sequencing in the background while
Move's own screens are in front (Back at the root → Background).

**Your drum racks work as they are** — Movy loads native Move `.ablpreset` drum
racks straight into a sampler module, so kits you already have need no conversion.

**Performance:** four tracks of Schwung synths generally run fine, including
heavier ones like Helm. Very dense patches across all four tracks are the case to
watch — if you hear trouble, simplify a patch or drop a voice count.

**After a Move firmware update** you may need to install Schwung again. Your Sets
are not affected; see Schwung's own documentation for the current procedure.

### "I loaded a drum module and the pads are silent"

Not a bug. **Mr Drums is a sample player, so it loads empty** and needs a kit:

1. Jog to **page 4 (Preset)**
2. **Hold the PRSET knob and click the jog** — a file browser opens
3. Pick a drum rack and jog-click to load it

Those are **native Move drum racks** (`.ablpreset` files in
`UserLibrary/Track Presets`), so kits you already have on the Move work as they
are. The same hold-knob-then-jog-click gesture opens the file browser anywhere a
parameter takes a file — including `SAMPL` on page 1, which swaps the sample on
a single pad.

Synthesis-based drum modules like Weird Dreams make sound as soon as they load;
only samplers need this step.

---

## Things to know before you file a bug

Movy is an **early prototype**. It runs on real hardware and is tested
end-to-end, but expect rough edges and the occasional crash. It is free and
open source, and it may never be "finished".

If something breaks, a **reproducible** report is worth ten vague ones: what you
did, what you expected, what happened, and which modules were loaded. A numbered
list of steps is gold.

→ **[Open an issue](https://github.com/DimaDake/schwung-movy/issues)**
→ **[CONTRIBUTING.md](../../CONTRIBUTING.md)** — build/test loop, and how to add a
layout template for a module that deserves one

## Say hello

There's a **#movy** channel in the **Schwung Discord** — questions, bug reports,
and what you've made with it are all welcome there.

<!-- TODO: paste the Schwung Discord invite link here before publishing. -->
