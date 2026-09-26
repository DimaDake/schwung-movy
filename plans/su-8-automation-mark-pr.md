# SU-8 — upstream PR text (NOT YET FILED)

Branch: `DimaDake/schwung` `feat/automation-mark-lock-strip` (local worktree
`/Users/dake/git/cld/schwung-lockstrip`, commit `d4fa4c66`, on `origin/main`
`8c58a376`). Not pushed, not filed — the user asked to hold it.

File with:

```bash
cd /Users/dake/git/cld/schwung-lockstrip
git push -u fork feat/automation-mark-lock-strip
gh pr create --repo charlesvestal/schwung --head DimaDake:feat/automation-mark-lock-strip \
  --title "param_pages: a sequencer lane gets its own mark (io.isAutomated)" --body-file <this section>
```

---

## param_pages: a sequencer lane gets its own mark (io.isAutomated)

A host that plays automation lanes wants the motion a modulated key already
gets: the pointer on `:base` and the dot riding `:effective`. The only way to get
it was to answer yes to `isModulated`, and that also drew the modulation tilde.
So a lane and an LFO wore the same mark, and a parameter under both showed only one.

**What changes**

- `io.isAutomated(fullKey) -> boolean` (optional). Asked on the same rotation
  stop as `isModulated`, cached beside it (`isAutomatedCached`). Never per draw.
- Either flag drives the motion (`moving()`), so `:base`/`:effective` and the
  riding dot behave exactly as for a modulated key.
- The movy layout draws a lane as a solid 2x2 at the top-right of the label
  (`drawAutomatedMark`, exported), which mirrors the tilde across the text. On an
  inverted band (a touched knob, or #509's held-step lock) it sits on ground,
  with one clear column from the strip.
- The dial layout has no lane mark, so an automated key keeps the tilde there.
- Absent the hook, nothing changes: an io without `isAutomated` draws
  byte-identically (asserted).

**Tests.** `tests/host/test_automated_mark.sh` covers the mark's pixels, its
clamp and gap, and the motion as reads. Each part fails when its fix is removed.
The 140 related host suites pass. Five fail identically on unmodified `origin/main`:
`help_viewer_chrome`, `knob_engine_single`, `knobs_list_layout`,
`knob_surfaces_access` and `trailing_pages_wiring`.

**Why schwung-movy declines the #509 lock corner (no change asked).** movy
sends `exact: false` on every held-step decoration, which keeps the inverted
value band and drops the top-left corner. This needs no library change, since
`exact` already gates only the corner. It is still worth stating why, because
the field is documented as "a point sits here". For movy the corner doesn't work:

- An automated parameter already wears this PR's 2x2 beside its label, all the
  time. On a held step the corner would be a second dot of the same shape, in
  another place, saying the same thing about the same parameter.
- On a cell a graphic covers (an envelope, a filter curve) the corner lands on
  the picture's own pixels and cannot be seen. Those are the cells where a lock
  most needs to read clearly.
- movy's lanes are per-step locks with no curve between them, so the
  point-versus-curve distinction `exact` exists for never comes up. The inverted
  value already says "this step locks it".

A future option would be for the corner to follow the host's lane mark when
`isAutomated` is supplied, but that is not asked here.

**Consumer.** schwung-movy feature-detects `drawAutomatedMark`. It moves its
lanes off `isModulated` only against a library that has the mark.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019GaWYoBvTvfEERdka8CmrU
