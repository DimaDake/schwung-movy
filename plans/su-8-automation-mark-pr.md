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

**Consumer.** schwung-movy feature-detects `drawAutomatedMark`. It moves its
lanes off `isModulated` only against a library that has the mark.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019GaWYoBvTvfEERdka8CmrU
