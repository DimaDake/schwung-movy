# Chunk 8 — Dump-replay regression harness (D)

Owns: new `browser-test/dump-replay.mjs`, new
`browser-test/dump-expect.json`, refactor of shared boot logic out of
`scripts/dump-movy-layout.mjs`. Independent. Wave 1 — ideally the first
chunk to land, since every other chunk updates its expectations.
Run `git -C movy pull` first.

---

## Prompt

You are working in `/Users/dake/git/cld` on **movy** (`movy/` — an
Elektron-style knob UI for Ableton Move). Read `movy/CLAUDE.md` and the
root `CLAUDE.md` and follow their workflow (local suites, commit + push,
200-line file limit, no code duplication — refactor shared logic into a
shared location). Run `git -C movy pull` first.

Background: `movy/docs/module-dump/device-dump.json` is a checked-in live
capture of all 76 modules installed on the device (raw `ui_hierarchy`,
`chain_params`, values, presets per module).
`movy/scripts/dump-movy-layout.mjs` already replays that capture through
the REAL model (`dist/esm/model/index.js` + `model.dumpLayout()` +
per-page `getViewModel()`) by stubbing the schwung globals with
`browser-test/env.mjs` — study it closely; it is the reference for
everything below. This chunk = IMPROVEMENTS.md **§ D "dump-driven
regression testing"**: turn that replay into a fast regression suite so
layout changes against ALL 76 real modules are caught, not just the 7
bundled configs.

### What to build

1. **Extract the shared replay core.** `scripts/dump-movy-layout.mjs`
   contains the boot logic (param-map building with componentKey
   prefixing, `synth_module`/name fallback, movy_config host_read_file
   serving, `createModel` + `reload` + 2 ticks). Move it into
   `browser-test/dump-boot.mjs` (exports something like
   `bootFromDumpEntry(entry) -> model` plus the layout/pages serializer)
   and make BOTH `scripts/dump-movy-layout.mjs` and the new test consume
   it — no duplicated logic. The generator's output files must stay
   byte-identical after the refactor (verify: run
   `npm run build:browser && node scripts/dump-movy-layout.mjs` before
   and after; `git diff docs/module-dump/` must be empty).

2. **`browser-test/dump-replay.mjs`** — a test runner in the style of
   `browser-test/logic.mjs` (same ✓/✗ output + exit code):
   - replays every module in `docs/module-dump/device-dump.json`;
   - asserts **global invariants** for every module/page:
     - booting never throws; page count ≥ 1;
     - every non-null param has a non-empty label, `min < max` or an
       options array for enums, `step > 0` for numeric types;
     - `getViewModel()` succeeds for every page;
   - asserts **per-module expectations** from
     `browser-test/dump-expect.json`, a checked-in snapshot keyed by
     `<category>--<id>` holding: page count, page names, per-page
     on-screen shortNames (from vm rows), count of envelope lines, count
     of lfoViz groups, hidden-param count. Generate the initial file
     from CURRENT behaviour (add a `--update` flag exactly like
     `screenshot.mjs --update`), then hand-verify a few entries against
     `docs/module-dump/SUMMARY.md` before committing.
   - Known-bad current behaviours (duplicate shortNames on 19 pages,
     duplicate preset knobs on impressive-chords/breakbeat, empty
     branchage/smack-in/belt-in) are **captured as-is** in the snapshot —
     parallel chunks fix them and run `--update` for their modules. Do
     NOT assert uniqueness of shortNames as a global invariant yet; add
     it as a `KNOWN_COLLIDING_PAGES` allowlist that other chunks shrink.
   - Runtime budget: the whole suite must run in a few seconds (it's
     pure JS over a 2 MB JSON — no per-test rebuilds).

3. **Wire into `npm test`.** Add it to the `test` script chain in
   `movy/package.json` after `logic.mjs` (look at how the four current
   suites are chained) and mention it in the dev-loop list in
   `movy/CLAUDE.md` (one line).

### Constraints

- The dump is a **snapshot**: it must never hit the network or device.
- `env.mjs` globals leak across modules if not reset — the existing
  generator calls `env.setParams()` fresh per module; keep that pattern
  and also reset `host_read_file` between modules.
- Don't “fix” any layout behaviour in this chunk — snapshot reality.
  The value is the diff-gate for the other chunks.
- File size limit 200 lines: split runner / invariants / expectations IO
  if needed.

### Verification & handoff

- `cd movy && npm run build:browser && node browser-test/dump-replay.mjs`
  → ALL CHECKS PASSED against the freshly generated snapshot; then
  `npm test` green end-to-end.
- Prove the gate works: temporarily hand-edit one expectation (e.g.
  change a page count), see the suite fail with a readable message
  naming module + field, revert.
- Regenerate-docs check described in step 1 (byte-identical generator
  output).
- Dev-tooling only — no MANUAL/README changes beyond the CLAUDE.md
  dev-loop line.
- Commit (refactor, runner+snapshot, npm wiring — 2–3 commits), push to
  main.
