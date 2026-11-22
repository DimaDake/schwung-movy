# Writing the Movy manual

Internal guidance for whoever edits the user manual (`site/`, published to
<https://dimadake.github.io/schwung-movy/>). The rules come from the user's own
instructions during the 2026-10-31 rewrite (`plans/2026-10-31-docs-site.md`)
and the corrections that followed it. Read this before adding to `site/`, and
check every release against it (`docs/RELEASING.md` step 4).

## The model

The manual should read like a real instrument manual: Elektron Digitone 2,
the Deluge Guidebook, Ableton Move's manual, the Teenage Engineering guides.
Each section says what to press, what you see, and what it does for the music.

The user's standing instruction is **"be mindful what we put there."** The old
2,500-line `MANUAL.md` was rejected as "a lot of useless info". A sentence has
to help someone use Movy, or it goes.

## What goes in

- **How to use it.** The gesture, the screen it opens, and what each control
  does there, in that order. Controls in bold, exactly as printed on the Move
  or the screen (`**Shift** + hold **Step 14**`, `**FREEZE**`).
- **The musical use, when it is real or obvious.** Ducking a bass under the
  kick is the point of a sidechain, so say it. Don't invent a use the code, the
  commits or the user never had in mind.
- **Images that actually help.** Screens come from the test baselines
  (`assets/screens/<baseline>.png`, exported by `scripts/site/build-assets.mjs`)
  and diagrams from `scripts/site/figures.mjs`. Use a picture where it saves
  reading (a screen you need to recognise, a pad layout, a gesture), not on
  every heading.
- **What a user can see go wrong**, in `reference/troubleshooting.md`: the
  exact on-screen message, what it means, and what to do.
- **Limits that change what a user can do** (a 60 s freeze loop, 32 lanes per
  track) go in the Limitations list and in the chapter where they bite.
- **Every control** goes in its chapter *and* in `reference/controls.md`.

## What stays out

- **Why it was built that way.** Design rationale, internals, engine
  commands, timing numbers, CPU microseconds, ENGINE versions. Those go in
  `docs/`, `plans/` or the changelog.
- **History and legacy.** Don't add sections that only make sense because of
  an older Movy ("this used to…", "removed in…", "earlier versions…"). A
  removed feature is not mentioned at all, not even to say it is gone (the
  Gemini mode, SAFE / BALANCED / WILD, the retired MOVY pages).
- **Back-compat features under a misleading name.** Describe them by what they
  really do. The Set import copies *older Movy and Schwung work* out of Move
  Sets. It does not export Move's own Sets, so it isn't called "importing
  your Move Sets" (`manual/sets.md` → "Work from older Movy versions and
  Schwung").
- **The obvious.** The user cut the whole "The panel" chapter and the line
  "Everything runs on the Move itself." as obvious. If a Move owner already
  knows it, or the screen already says it, leave it out.
- **Navigation extras.** The "I want to…" index was added and then removed as
  overkill. The generated Contents list (`<!-- contents -->`,
  `scripts/site/contents_hook.py`) and the sidebar sections are enough.
- **Dev-facing text.** Build steps, harness notes and file paths stay out of
  the manual, except `install.md` → "Building from source" and a file a user
  really creates (the worn-encoder filter).

## Structure

- **One chapter per area**, each a reasonable size: you should be able to read
  a chapter in one sitting. When a chapter outgrows that, split it by task, not
  by implementation module.
- **"Works like Move" blocks.** Behaviour identical to Move's own firmware goes
  in a collapsed `??? move "Works like Move: …"` block, so a Move owner can skip
  it. Only what is truly the same goes there. A difference belongs in the body,
  and in `reference/controls.md` → "Shortcuts that differ from Move".
- **Install comes first.** `install.md` leads with the one-command installer
  and its builder (`assets/install-builder.js`), then the other ways.
- **`README.md` is the landing page.** Only headline features get a bullet.
  `MANUAL.md` is a pointer; don't grow it back.

## Voice

Short sentences in the second person and the present tense. Say what happens,
not what the software "allows". Use the words the screen uses. Write like a
person explaining the instrument: no taglines, no tidy triplets, no em dashes
(only inside quoted screen text such as `32 AUTOMATION LANES — FULL`).

## Checking it

- **Every fact against the code**, never against a commit message or the
  changelog: gesture, label text, knob order, limits, defaults. Prose drifts
  when a feature changes after its paragraph was written. A renamed knob or a
  removed setting is the usual failure.
- **At release**, list the user-visible commits since the last tag and find
  each one in the manual: new features, changed gestures, changed defaults, and
  new on-screen messages.
- `npm test` runs `build-assets.mjs --check` (stale screens or diagrams).
  After a UI change, regenerate with `node scripts/site/build-assets.mjs`.
- Dead links and anchors fail `mkdocs build --strict`. That runs only in the
  Pages workflow, after the push, so run it locally before pushing a manual
  change (`pip install -r scripts/site/requirements.txt`).
- **For a large rewrite**, run cold reviewers on the rendered site: one who
  knows nothing about Movy, and one who knows Move but not Schwung or Movy.
  Give them scenario walkthroughs ("make a beat and save it"). Ask for
  `file:line` findings, then check each finding against the code before
  fixing it.
