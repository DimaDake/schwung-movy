# Per-set state in Schwung: what breaks, and what could be fixed centrally

**Status:** Investigated and worked around in one tool (2026-08-27/28). Nothing
in this document has been changed in schwung — it is written to open a
conversation about fixing it once, centrally, rather than once per tool.

**Scope:** The failure is in Schwung's per-set layer and can cost Schwung's own
slot state, but **in practice it lands on tools**, for a reason worth stating up
front: loading a Schwung synth means selecting a track, and selecting a track is
what makes Move commit the Set. The normal Schwung workflow therefore
materialises the Set incidentally, and this stays invisible.

A tool opened **straight from Move's Sets page** never makes that gesture. The
user picks a pad, opens the tool, and plays entirely inside it — Move is given
nothing to save, the Set is never committed, and everything either side writes
for it is written under an id that will not exist next time. That is the path
where all three problems below become the user's normal experience.

**Written from:** schwung `origin/main` at the time of writing, plus measurements
on a Move running it. File and symbol references are to that tree.

---

## TL;DR

1. **A Set that Move never wrote to disk gets a NEW identity on every visit.**
   `shadow_poll_current_set` mints `__pending-<index>-<seq>` with an
   ever-incrementing seq, so everything keyed on it — Schwung's `slot_*.json`
   and any tool's per-set files — is written somewhere nothing will read again.
   A user playing entirely through Schwung never materialises a Set, so this is
   not an edge case for them; it is every Set they own. Making that id *stable*
   is not the fix — Move's UI shows those pads as empty, so the stores would
   then disagree with the UI. Making the Set **real** is.

2. **Nothing ever collects state for a deleted Set,** and the obvious test for
   "deleted" is wrong: switching set pages moves whole Sets out of
   `UserLibrary/Sets/`, so a bare `stat()` there reads every Set on every other
   page as gone.

3. **A tool cannot ask Move to commit a Set,** because the inject drain is
   closed while a tool is overtaking. The only way through today is for the tool
   to lower `overtake_mode` itself for a moment, which costs the pad LEDs and
   the surface for the duration.

---

## 1. The pending-set namespace changes identity on every visit

### Mechanism

`shadow_poll_current_set` (`src/host/shadow_set_pages.c`) resolves the current
Set by scanning `UserLibrary/Sets/` for the directory whose `user.song-index`
xattr matches `currentSongIndex` from `Settings.json`. When nothing matches it
publishes a synthetic id:

```c
sampler_pending_set_seq++;
snprintf(pending_uuid, sizeof(pending_uuid), "__pending-%d-%u",
         song_index, (unsigned)sampler_pending_set_seq);
```

The seq increments whenever the song index changes and never resets, so one set
pad produces a different identity each time it is opened.

Nothing matches because **Move only writes `Sets/<uuid>/` once Move itself has
something to save there.**

This is why the problem looks rare from inside Schwung. Selecting a track — the
first thing anyone does to load a synth — is enough to make Move commit the Set,
so the pending window closes on its own and matches the 12-60 s the code
comments describe. Open a tool directly from the Sets page instead and no such
gesture ever happens: the pad stays unresolved not for a minute, but forever, and
every visit mints another id.

### What it costs

Everything keyed on that id is orphaned on the next visit:

| Store | Symptom for the user |
|---|---|
| `set_state/__pending-<n>-<s>/slot_*.json` | the pad's instruments are gone |
| a tool's own per-set files | the pad's sequence/pattern is gone |

Measured on one device: **32 set pads, 8 real Sets.** `set_state/` held pending
directories for indices 2 through 31, several per index — `__pending-9-2`
through `__pending-9-7` for six visits to one pad. One tool's tree held
`__pending-17-1` with 766 bytes of sequence and 36 KB of UI state, unreachable.

From the user's seat this reads as "this pad only remembers my layout" — the
layout survives because it lives in memory, not because anything saved it.

### The fix is NOT to make the pending id stable

The obvious idea — key the namespace by song index alone, so one pad keeps one
directory — was built and measured working, and it is still the wrong answer.
**Move's UI shows those pads as empty.** Restoring instruments and a pattern into
a pad that Move presents as an empty Set puts the stores in open disagreement
with the UI the user is looking at, and Move is free to reuse an index, so the
state can later attach to something else entirely.

The identity is not the problem. **Having an identity Move does not recognise is
the problem.**

### The fix is to make the Set real

Move commits a pending Set on a track-button press (CC 40-43): an injected press
turns `__pending-<n>-<s>` into a real uuid within seconds, and the Set survives
being left afterwards. Measured repeatedly on device. Once it is real, Move's UI,
Schwung's slot state and every tool's per-set files all agree, and the whole
problem class disappears rather than being papered over.

Note what that gesture is: **the same track selection a user makes to load a
Schwung synth.** This is not a synthetic trick that happens to work — it is
Schwung's own users' normal path, replayed for the case where nobody walked it.

**Schwung is the right place to do this**, for two reasons:

1. It already owns a path that reaches Move under overtake —
   `shadow_queue_packet_to_move` (`src/host/shadow_midi.c`), used today to send
   shift-off on overtake entry. From the shim this is one call with none of the
   ceremony section 3 describes: no `overtake_mode` juggling, no LED damage, no
   driving a transition the shim itself guards.
2. It fixes Schwung's own instruments at the same time, and every tool inherits
   it without changing a line.

The open design question is **when** to fire it. Candidates:

- when `shadow_poll_current_set` first publishes a pending id (earliest; commits
  a Set the user may only be passing through);
- **when an overtake tool opens on a pending Set** — precisely the path that
  skips the track selection, and the only one where the window stays open
  indefinitely;
- when anything is first *persisted* under a pending id, from either side;
- when a tool declares it keeps per-set state, via a capability.

The second looks best from here: it is narrow, it fires exactly where the
incidental commit was missed, and it leaves a pad the user merely browsed past
untouched.

## 2. State for deleted Sets is never collected, and "deleted" is subtle

### Nothing collects

Deleting a Set in Move removes `UserLibrary/Sets/<uuid>/` and leaves every
per-set store behind permanently. Measured on one device: 11 per-set
directories for one tool backing 6 live Sets, one dead directory holding 1474
bytes of sequence and 16 KB of UI state.

### The aliveness test is not `stat(Sets/<uuid>)`

Switching set pages (`shadow_change_set_page`) **moves whole Set directories**
into `set_pages/page_<n>/`. From any other page, a bare check of `Sets/` reports
every Set on every other page as deleted. The device this was found on had 28
Sets stashed on page 0 while page 1 was current — a naive sweep would have
deleted the state for all of them.

davebox already carries the correct test and a warning against simplifying it
(`seq8_set_uuid_alive`, `dsp/setparam/sp_globals_state.c`): alive means present
in `Sets/` **or** under any set-page stash root.

### Why tools cannot do this well from JS

- There is no directory listing in the module JS API, so a tool can only ask
  about uuids it already knows. Driving the sweep from a name index misses any
  Set whose index entry was overwritten — a real gap, since the index is keyed
  by set *name*.
- `host_remove_dir` is permitted only under `modules/` (`js_host_common.c`), and
  there is no `host_remove_file` at all. A tool that stores state in
  `set_state/<uuid>/` — which is where davebox stores it, alongside Schwung's
  own files — therefore **cannot delete it from JS at all**. davebox prunes from
  its DSP, in C, where `opendir` and `unlink` are available.

**Possible central fix:** Schwung deletes `set_state/<uuid>/` when it observes a
Set disappear, using the page-aware aliveness test. Every tool that keeps its
files in that directory is then cleaned up for free, and no tool needs a C-side
pruner to manage its own litter.

---

## 3. A tool cannot ask Move to commit a Set

Problem 1 has a second possible answer: rather than tolerate an unreal Set, make
it real. Move commits a pending Set on a **track-button press** (CC 40-43) — a
press injected onto the ring turns `__pending-<n>-<s>` into a real uuid within
seconds, and the Set survives being left afterwards. Measured repeatedly.

A tool cannot send it, though:

```c
/* In OVERTAKE mode the queue belongs to the overtake publisher in
 * schwung_shim.c, not to us. */
if (sc && sc->overtake_mode != 0) return;
        — shadow_drain_midi_inject(), src/host/shadow_midi.c
```

`move_midi_inject_to_move` pushes to a ring that, under overtake, is drained for
the overtake module instead of Move — so the packet never reaches Move's
MIDI_IN. There is no startup window either: `loadOvertakeModule` sets
`shadow_set_overtake_mode(2)` in step 1 and calls the module's `init()` in step
6.

The shim has its own path that *does* reach Move under overtake
(`shadow_queue_packet_to_move`, used to send shift-off on overtake entry), but it
is C-only with a single caller and no JS binding.

### The workaround, and what it costs

`shadow_set_overtake_mode` is exposed to modules, so a tool can lower the flag
for the length of one press and put it back. It works — but for that moment:

- the pads and surface belong to Move, so a pad pressed then plays Move;
- lowering the flag clears `overtake_suppress_sysex`, so Move repaints the pad
  LEDs and the tool must re-claim ownership *and* force a full repaint;
- the shim sees an overtake exit and re-entry, including the 3-frame inject-drain
  hold that exists because a packet arriving mid-transition aborts Move deep in
  its own stack. The press has to be timed after that hold.

That is a lot of ceremony, driving a transition the shim explicitly guards, to
send one button press. **A JS binding for `shadow_queue_packet_to_move` — or any
sanctioned "deliver this packet to Move" call — would remove all of it.**

---

## What one tool does today, for reference

Not a proposal, just the current state of the workarounds, so the cost of *not*
fixing this centrally is concrete:

1. Follows `active_set.txt` verbatim, including pending ids, exactly as davebox
   does — so its files agree with Schwung's, and it loses the same work Schwung
   loses on those pads.
2. Borrows the surface for one track-button press when it opens on an
   unmaterialised Set, so the Set becomes real and both stores start persisting.
3. Collects its own dead Sets from a name index, with the page-aware aliveness
   test — best-effort, because it cannot list a directory.

---

## Open questions

1. Should Schwung commit a pending Set itself, from the shim, via
   `shadow_queue_packet_to_move`? If so, at which moment (see section 1)? This
   looks like the single highest-value change here, and it is the one a tool
   cannot make well from outside.
2. Should Schwung own deletion of `set_state/<uuid>/`, so tools storing files
   there are cleaned up without each shipping a C-side pruner?
3. Is there appetite for a JS-reachable "send this packet to Move" that works
   under overtake? It would replace the overtake_mode borrowing above, and is
   presumably useful to more than one tool — but if question 1 is answered yes,
   no tool needs it for this.
4. Is there a supported way to ask Move to commit the current Set that does not
   involve synthesising a button press at all? The press is the only trigger
   found by experiment; there may be a real API behind it.
