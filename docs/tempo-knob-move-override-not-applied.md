# Movy TEMPO knob doesn't change Move's tempo (Link‑subscriber dormant)

**Status:** Root cause found and confirmed on-device (2026-07-14). **Not a movy
bug** — movy behaves correctly. The fix, if wanted, is a **schwung** change.
Documented here per the Phase 3 ground rule "zero schwung changes — stop and
report."

**Scope:** Phase 3 Move‑sync, item 2 ("tempo knob writes the Link override").
Everything else in Phase 3 works: movy locks to Move's transport, follows Move's
tempo, shows **EXT**, reverts cleanly on stop. Only the **movy → Move** tempo
direction is affected.

---

## Symptom

With Move's native sequencer playing and movy following (cell shows **EXT**),
turning movy's **TEMPO** knob makes the on-screen number jump briefly and then
**snap back**; neither Move nor movy changes tempo audibly.

## TL;DR root cause

movy's TEMPO knob correctly debounce-writes the new tempo to
`/data/UserData/schwung/desired-tempo`. That file is consumed **only** by
schwung's `link-subscriber` sidecar, which proposes the tempo to the Ableton
Link session (`state.setTempo`). That sidecar **only runs while Link Audio
routing is enabled** (`shadow_process.c` monitor gate). Link Audio routing is
**OFF by default**, so the sidecar is not running, so `desired-tempo` is never
read, so Move's tempo never changes. movy then re-captures Move's *unchanged*
tempo from the MIDI clock and the UI value "restores back."

Note the asymmetry:

- **Move → movy** tempo follow works because movy measures Move's **MIDI clock**
  tick interval (engine `on_external_realtime` EMA). This is independent of Link
  and independent of the sidecar — which is why it always works.
- **movy → Move** is the only path that needs the Link sidecar, and that is the
  one that's dormant.

---

## Evidence (device, 2026-07-14)

Boundary-by-boundary, from movy outward:

1. **movy writes the file.** After turning the knob, `desired-tempo`'s mtime was
   fresh (within the action window). movy's write path is correct:
   `src/seq/main-page.ts` → `scheduleTempoOverride()` → `src/seq/tempo-override.ts`
   → `host_write_file('/data/UserData/schwung/desired-tempo', …)`. Same
   `host_write_file` + path schwung itself uses on set-change.

2. **Nothing consumes it.** `ps` on the device shows **no `link-subscriber`
   process**. Writing the file by hand also did nothing:

   ```sh
   # session-tempo readback, written by the sidecar's setTempoCallback:
   cat /data/UserData/schwung/last-tempo        # 106.9999, mtime 2026-05-25 (!)
   printf '137.0000\n' > /data/UserData/schwung/desired-tempo
   sleep 2
   cat /data/UserData/schwung/last-tempo        # still 106.9999, mtime unchanged
   ```

   `last-tempo` hadn't been touched since May — the Link tempo path has been
   dormant for a long time.

3. **The sidecar is gated on Link Audio.** Device config
   `/data/UserData/schwung/shadow_config.json`:

   ```json
   "link_audio_routing": false,
   "latency_comp_enabled": false
   ```

   and `link_audio_enabled` is absent (defaults false in
   `schwung_shim.c:936`).

4. **The gate, in schwung source** (`src/host/shadow_process.c`,
   `link_sub_monitor_main`, ~line 364):

   ```c
   if (!host.link_audio->enabled || !link_audio_routing_enabled) {
       /* routing disabled — kill the subscriber ... */
       ...
       continue;   /* never launches it */
   }
   ```

   So with Link Audio routing off, the sidecar is killed / never launched.

5. **What the sidecar would have done** (`src/host/link_subscriber.cpp:280-301`):
   polls `desired-tempo` mtime at ~100 Hz and, if `numPeers() <= 1`, calls
   `state.setTempo(bpm, …)` (logging `tempo override applied/skipped`). Its
   stdout/stderr are redirected to `/dev/null` (`shadow_process.c:318`), which is
   why those log lines never appear in `debug.log` — absence of the log is **not**
   evidence it ran.

Conclusion: the chain `knob → desired-tempo (OK) → [sidecar: NOT RUNNING] → Link
→ Move` breaks at the sidecar. movy is correct end-to-end up to the file.

---

## Why this wasn't caught earlier

The Phase 3 design (`plans/2026-07-12-transport-beat-clock-design.md` §7) and the
recall memory noted the desired-tempo → Link override was "proven on-device (used
on set change)." That proof almost certainly happened with Link Audio enabled (or
during a set-load moment when the sidecar path was active). The design assumed
the override is always available; in fact it is **coupled to Link Audio routing**
being on, which is off by default. The movy plan's device follow-verification
step 4 (tempo knob → Move) is the step that surfaces this, and it requires the
physical Move sequencer, so it wasn't exercised by the automated suites.

---

## Options for a permanent fix

1. **Schwung: decouple the tempo path from Link Audio (recommended real fix).**
   Make the `desired-tempo` poller (and a minimal Link peer) run independently of
   `link_audio_routing`, e.g.:
   - run a lightweight always-on Link peer + desired-tempo poll in the shim/host,
     separate from the audio-routing sidecar lifecycle; **or**
   - relax the `link_sub_monitor` gate so the sidecar stays up for the tempo path
     even when audio routing is off (it already forks cheaply; the concern in the
     comment is fork-churn/audio clicks from *restarting*, not from staying up).
   This is a **schwung change** → goes through the schwung worktree +
   device-verify + upstream flow. Out of scope for the movy repo.

2. **Workaround, no code:** enable **Link Audio routing** (Global Settings →
   Audio → Latency Comp) so the sidecar runs. Then movy's TEMPO knob drives Move.
   Downside: turns on the audio-rebuild / latency-comp path (~9 ms artifacts on
   toggle), i.e. an unrelated heavy feature just to get tempo sync.

3. **Document-only (current choice):** ship Phase 3 with the caveat that movy's
   TEMPO knob changes Move's tempo **only when Link Audio is enabled**; otherwise
   set tempo from Move. Move → movy follow, EXT, lock, and revert are unaffected.

## Possible movy-side UX mitigation (optional, not a fix)

movy cannot reach Move's tempo without the Link path, so it cannot *fix* this
alone. It could, however, avoid the confusing "jump then snap back": e.g. suppress
the optimistic `bpmX100` bump while `extSync` is true (show Move's captured tempo
only), so the knob visibly does nothing rather than teasing a change. This is a
cosmetic honesty tweak, independent of the real fix, and only worth doing if we
decide not to pursue option 1 soon.

---

## Reproduce / verify

1. `ssh ableton@move.local 'cat /data/UserData/schwung/shadow_config.json'` →
   confirm `link_audio_routing: false`.
2. `ssh ableton@move.local 'ps w | grep link-subscriber'` → empty.
3. `printf '137.0000\n' > /data/UserData/schwung/desired-tempo` then check
   `last-tempo` is unchanged → sidecar not consuming.
4. To confirm the fix path: enable Link Audio routing, verify a `link-subscriber`
   process appears, repeat step 3, and confirm `last-tempo` (and Move's tempo)
   follow the written value.

## Source pointers

- movy (correct): `src/seq/main-page.ts` (knob → `scheduleTempoOverride`),
  `src/seq/tempo-override.ts` (debounced `host_write_file`),
  `src/app/tick.ts` (`tempoOverrideTick()` before the parked early-return).
- schwung (the gate + consumer):
  `src/host/shadow_process.c` `launch_link_subscriber()` / `link_sub_monitor_main`
  (gate ~line 364); `src/host/link_subscriber.cpp:256-306` (desired-tempo poll +
  `setTempo`), `:165-199` (`last-tempo` readback).
- device: `/data/UserData/schwung/{shadow_config.json,desired-tempo,last-tempo,link-subscriber}`.
