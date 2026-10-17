# Pin schwung's shared JS (reverses migration decision 6)

**Decided 2026-10-13 (user).** movy-host already compiles schwung's C from the
pinned tag (`scripts/lib/schwung-pin.sh`); the JS it runs (`param_pages`,
`text_entry`, `lane_voice_map`, `shadow_ui_slot_grid`, and what they import)
still came from whatever schwung the device had installed. That was right
for the overtake movy, which shared shadow_ui's process; since WP9 nothing
else runs movy's copy, and the float was the source of the pinned-C /
floating-JS mismatch that the globals manifest, `abi-parity` and the floor
exist to police (and of several red tiers after a schwung upgrade).

**Rule after this:** pin what movy RUNS, float only what it does not ship
(modules, the Tools door's `launch-standalone.sh`, boot-target scripts, the
hand-back to `schwung-entry.sh`). The shipped JS is the tag's bytes,
**never edited**: a change movy needs is still an upstream PR, then a pin bump.

## Tasks

1. `scripts/build-schwung-js.sh` + `scripts/schwung-js-closure.mjs`: from the
   pinned tag (`git archive`), the static import closure of every
   `/data/UserData/schwung/{shared,shadow}/…` specifier movy names, into
   `dist/schwung-js/` with a `PIN` file. Stamped on tag + seeds.
2. movy-host's module normalizer (`host/module_path.c`, unit-tested):
   `/data/UserData/schwung/{shared,shadow}/X` → `<module dir>/schwung/{shared,shadow}/X`,
   after the usual relative resolution. No fallback to the installed copy.
3. Ship it: `deploy_host` (so `deploy.sh`, the harness and the vdev get it,
   fresh directory swapped in), `build-module.sh` (the store tarball).
4. Tests run the shipped bytes: `build/browser.mjs` aliases to
   `dist/schwung-js/`; `host-globals.mjs` reads the same tree.
5. Docs: CLAUDE.md Schwung-page rule 2, "Which tier gates", the QuickJS
   module-cache note; migration plan decision 6; movy-host.md; vdev.md.

## Not in this change (follow-ups)

- ~~`src/renderer/schwung-floor.ts` still gates page mode on the INSTALLED
  version~~ — done in `plans/2026-10-13-schwung-pages-only.md`: the file keeps
  only `SCHWUNG_FLOOR` for movy-host.
- ~~The `schwung-missing` fallbacks in `schwung-lib.ts`~~ — done there too:
  `schwung-lib.ts` is static imports.

## Gate

Local + device tier (host C, deploy path and the JS source all change).
