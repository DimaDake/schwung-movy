# Out-of-thread synths (osirus, minijv): latency — proposal

**Status:** proposal, not started (2026-10-13, after WP11). The user asked
whether running these modules directly in movy would remove the extra latency
they seem to add, and what else could reduce it.

**Safety rule (user):** never run osirus or minijv in more than one chain at a
time; several instances can crash the device past recovery.
`scripts/measure-render-pool.mjs` already refuses that.

## What we know (WP11)

- osirus (Virus, gearmulator) forks a child process from the chain load; its
  `DSP` thread runs the DSP56300 emulator. `v2_render_block` copies 128 frames
  out of a shared-memory ring (`virus_plugin.cpp`, see
  `project_movy-cpu-meter-page` memory). The fork inherited core 3 + FIFO 70
  until `host/placement.c` (WP11) started moving it to cores 0-2.
- minijv runs a `jv880-emu` thread (SCHED_OTHER, cores 0-2).
- Neither module's ring depth or handoff scheme has been read yet.
- `padlat` (`engine/crates/movy-dsp/src/pad_latency.rs`) times a note from
  `on_midi` to the first loud block of its chain, so it measures these modules'
  latency end-to-end, inside movy, with no outside polling.

## Not recommended: run them inline in movy's render

- **Cost.** Each emulator needs a large share of a core continuously. Inline,
  one instance takes most or all of a lane's 2.9 ms block budget; the separate
  thread/process is what lets it run outside the render window.
- **No latency win by itself.** The latency is the buffer between the emulator
  and `render_block`, not the thread boundary. Inline, the same block becomes a
  deadline risk instead.
- **Isolation.** osirus's emulator runs in its own process, so it can crash
  without taking movy-host down. Inline it would not.

## Proposal, in order

1. **Measure (cheap, first).** One instance each, held/struck notes, read
   `padlat` (blocks) for osirus, minijv, and a native synth as control. Add a
   `--padlat` mode to `measure-render-pool.mjs` or a small scenario-free
   script. Record in `docs/track-performance.md`.
2. **Read the modules.** Find each ring's depth and how the producer is
   paced: free-running ahead (latency = fill level) or kicked per block.
   Sources: schwung-virus (`virus_plugin.cpp`), minijv's jv880 wrapper.
3. **Shrink the ring** to what the jitter needs. It was sized for overtake,
   where the emulator competed with Move's FIFO 70 workers and (for osirus) the
   audio core itself; WP11 removed both. A module change → **upstream PR** to
   each module repo (never a movy patch).
4. **One-block pipeline** if not already: at each `render_block`, signal the
   emulator to compute block N+1 and return block N. A fixed 2.9 ms, no extra
   slack; the floor for any out-of-thread producer.
5. **Guarantee the emulator a core** so a small ring is safe. Options, to be
   measured with `measure-render-pool.mjs lanes` + `late_frames` + `padlat`:
   - plan 3 render lanes instead of 4 while an out-of-thread module is loaded
     (the engine plans lanes per Set already; `chlanes` exists as the
     diagnostic). Needs a way to know a module is out-of-thread: a module.json
     capability (upstream) or movy's own list;
   - or give the emulator thread a realtime priority below the helpers
     (FIFO < 68), set by movy-host's placement sweep.
6. **Note timing.** If notes reach the child once per block with no in-block
   offset, timing jitters by up to one block on top of the latency. Passing the
   offset fixes jitter, not latency. Check in step 2.

## Exit

`padlat` for osirus and minijv at or near 1-2 blocks with no late transfers on
the WP11 sets; the upstream PRs filed; any lane rule measured and documented.
