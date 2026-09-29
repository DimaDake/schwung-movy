# Retire the stand-ins Schwung 1.5.0 replaced (2026-09-29)

Schwung **v1.5.0** (2026-09-27) carries all four of the user's September
param_pages PRs: #519 (SU-14), #541 (SU-8), #542, #543 (SU-11/16/17/18). The
device runs 1.5.0. Each movy stand-in below was written "until a release
carries it"; this deletes them and raises `SCHWUNG_FLOOR` to 1.5.0 so an older
host falls back to movy's own pages (the floor gate) instead of breaking.

| Item | Upstream | movy change |
|---|---|---|
| Big cells (COND, LEN, SWING, ROOT) | #543 `display: "big"` | `viz: BIG_VALUE_KIND` → `display: 'big'`; delete `schwung-big-value.ts` |
| Ordered two-way on virtual pages | #543 `turn: "absolute"` | virtual enums declare it; drop SP-57 H3 special case in `schwung-page-input.ts`; the virtual source skips a same-value write (what the H3 skip did) |
| Option panel over a legible cell | #543 `io.allowEnumPeek` | `peekSuppressed` answered through the io hook; drop H6 `dismissPeek` |
| Never-resting key redraws forever | #543 `activity()` | `animating()` reports moving/streaming; the cap throttles only `streaming` |
| Lane mark | #541 `io.isAutomated` | drop the `isModulated` fold + `lanesHaveOwnMark` feature detection |
| Re-plan cost | #519 | comment only (RELOAD_POLL_TICKS stays 16 until re-measured) |
| Lock drives the graphic | #542 | nothing movy-side |

Gates run with `SCHWUNG=../schwung-v1.5.0` (a detached worktree at the tag) —
the pinned `../schwung` predates #541/#543.
