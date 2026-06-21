# Free automation lanes when no clip uses them (2026-06-21)

## Motivation

Automation lanes are per-track (the 8-lane pool); locks are per-clip. Today a
lane is only freed by an explicit Hold-Clear+knob or a module change. So
deleting a clip, or clearing a param's automation in a clip, leaves the lane
**assigned but lock-less** — it keeps occupying the pool until reboot, which is
another path to premature "pool full". (Follow-up to the lane-pollution fixes in
`2026-06-20-automation-lane-pollution-fixes.md`.)

## Rule

Free a lane the moment its **last lock across all clips on the track** is
removed. A lane with zero locks anywhere is inert (its base equals the static
param value), so it's released back to the pool. Covers both "delete clip" and
"delete a param's automation", and keeps a lane that another clip still uses.

Policy (decided): a lane with a base but **zero locks → free it**.

## Engine (seq-core)

- `Clip::has_lock_on_lane(lane) -> bool`.
- `Engine::free_unused_lanes(track)`: for each assigned lane, if no clip on the
  track locks it, clear `lane_assigned/lane_label/lane_base/auto_cur`.
- Call it at the end of every lock/clip removal:
  `delete_clip`, `delete_clip_at`, `paste_clip`, `delete_range`,
  `auto_clear_step`, `auto_clear_step_all`.
  (`auto_clear` already frees the whole lane — no change.)
- Update the "lane stays assigned" comments on `auto_clear_step*`.

## UI (src/seq)

After issuing a removal command, `requestLabelSync()` so the registry drops the
freed lane (reuses the validating sync from the lane-pollution fix). Ordering is
safe: the queued cmd flushes in `seqEngineTick()` at the top of the next tick,
before `takeLabelSync()` reads `alabels`. Sites: `clipdel` (edit-ops),
`clipdelat` (session), `aclrs`/`aclrstep` (automation), `clippaste`
(duplicate), `delrange` (if present).

## Tests

- cargo: lane used by clips 0+1 → delete clip 0 keeps it, delete clip 1 frees
  it; lone lock in active clip → `auto_clear_step` frees; `auto_clear_step_all`
  frees a step-only lane; a lane with locks in another step stays.
- logic.mjs/app-loop: a removal gesture re-requests label sync; freed lane
  leaves the registry.
- Device: delete a clip / clear automation, confirm `auto lanes` drops the lane.
