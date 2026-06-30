# Contributing to Movy

Thanks for your interest! Movy is an **early prototype** built for fun and
experimentation, and contributions — code, module layout templates, docs, or
good bug reports — are very welcome.

Please keep in mind: I can't promise to merge everything or to keep the project
going indefinitely. Opening an issue to discuss a larger change before you build
it is usually the fastest path.

---

## Reporting bugs

A reproducible bug report is the single most useful contribution. Please include:

1. **Steps to reproduce** — a numbered list.
2. **Expected** vs **actual** behaviour.
3. **Which modules** were loaded in the chain (and on which track).
4. Device/log details if you have them.

See the [manual's troubleshooting section](MANUAL.md#9-troubleshooting--recovery)
for how to grab logs.

---

## Project layout

Movy is a Schwung tool module. The interesting parts:

```
movy/
├── src/              TypeScript source (UI). Bundled to ui.js — never edit ui.js directly.
│   ├── types/        Shared interfaces (no logic).
│   ├── model/        Knob/param state machine (no display calls).
│   ├── renderer/     Pure display functions (no state).
│   ├── modules/      Per-module layout templates (JSON).
│   ├── seq/          The sequencer UI layer.
│   ├── keyboard/     Pad → note mapping, drums.
│   └── ...
├── engine/           Rust workspace: seq-core (pure logic) + movy-dsp (→ dsp.so).
├── browser-test/     Headless tests (logic, app-loop, screenshot, perf).
├── scripts/          build / deploy / device-test scripts.
└── plans/            Design & implementation notes per feature.
```

Two hard architectural rules:

- **`model/` never calls display functions**, and **`renderer/` holds no state.**
  State lives in `model/` and `app/state.ts`; renderers are pure
  `ViewModel → pixels`.
- **Files stay small** — hard cap **200 lines**, target 50–100. One
  responsibility per file.

---

## Build, deploy, test

```bash
npm install

# Build
npm run build           # device bundle (ui.js) + browser test modules
npm run typecheck       # tsc --noEmit, must be clean

# Local tests (no device needed) — run all of these before sending a PR:
npm test                # builds, then runs the four suites below
#   browser-test/logic.mjs       viewmodel / business-logic assertions
#   browser-test/app-loop.mjs    full init/tick/MIDI loop → setLED
#   browser-test/screenshot.mjs  framebuffer pixel-diff vs baselines
#   browser-test/perf.mjs        fill_rect / IPC / render-time budgets

# Rust engine (only if engine/ changed)
cd engine && cargo test

# Deploy + device end-to-end (when a Move is reachable at move.local)
./scripts/deploy.sh
./scripts/test.sh       # param-UI e2e
./scripts/test-seq.sh   # sequencer e2e (also builds + deploys dsp.so)
```

**If you change any UI rendering**, update the screenshot baselines and commit
them:

```bash
node browser-test/screenshot.mjs --update
```

**Performance matters** on this hardware. If you add rendering or hot-path logic,
add/extend a perf test and keep `perf.mjs` green.

---

## Adding a module layout template

Most modules work with no template — Movy reads their parameter hierarchy and
lays it out automatically. Add a template only when a module deserves a nicer
arrangement, or when it's a **drum** module (drums can't be configured from the
device otherwise).

1. Create `src/modules/<module-id>.json` following the `ModuleConfig` shape in
   `src/types/param.ts` (see `src/modules/plaits.json` / `wurl.json` for
   examples).
2. Register it in `src/modules/loader.ts` (add an import + a `CONFIGS` entry).
3. `npm run build` bundles the JSON in automatically.
4. Add a screenshot test for the new layout and run `npm test`.

> Longer term, the goal is for layouts to be read from the module itself rather
> than bundled here — so keep templates declarative and minimal.

---

## Pull request checklist

- [ ] `npm run typecheck` is clean.
- [ ] `npm test` passes (logic, app-loop, screenshot, perf).
- [ ] Screenshot baselines updated if rendering changed.
- [ ] `cargo test` passes if you touched `engine/`.
- [ ] Device e2e (`./scripts/test.sh` / `test-seq.sh`) run if you have hardware
      — note in the PR if you couldn't.
- [ ] New rendering → a screenshot test; new logic → a logic test.
- [ ] No code duplication; shared logic factored out.
- [ ] Comments explain **why**, not what.

Thanks again for helping make Movy better! 🎛️
