# Unified set migration (Move/Schwung → movy library)

Status: DESIGN APPROVED 2026-10-17, implementation NOT started.
Read against schwung `586aebd4` and movy `a5f61d7` (branch standalone-migration).

## Decisions (user-approved)
- One migration, run automatically ONCE (marker in `library.json`: `"migrated":<ms>`),
  never again on its own, whatever is added later.
- Settings action row **MIGRATE FROM MOVE**, armed → `CONFIRM?` (pattern of the deleted
  MIGRATE TRACKS row, commit 2edf182: arm in `migrate-action.ts`, disarm when the
  selection leaves the row; router.ts:789 handles action-row clicks). Hint says it was
  already done on <date> and overrides earlier migrations.
- Override (option A): only Sets with `legacy == <Move uuid>` are replaced; Sets made in
  movy (no `legacy`, incl. duplicates of migrated Sets) are never touched. Each replaced
  Set gets a `pre-migrate` version capture first (BACKUPS can undo). Name resets to Move's.
  A previously deleted migrated Set comes back on a manual run.
- ALL schwung set pages: `UserLibrary/Sets/<uuid>/<name>/` (current page, number in
  `schwung/set_pages/current_page.txt`) + `schwung/set_pages/page_0..7/<uuid>/<name>/`
  (+ `dbx-host/set_pages`). A uuid on no page = deleted in Move → not imported
  (except movy legacy-tree folders, which keep today's behaviour incl. "Recovered").
- Name collisions across pages: lowest page keeps `Set 1`, others `Set 1 · P3`
  (CHECK the tiny font has `·`; fall back to ` P3`). NOTE: library list order stays
  newest-first by `created` (set_library.rs `ordered`) — page order was NOT implemented;
  tell the user.
- Include Move Sets movy never opened when `schwung/set_state/<uuid>/` has a slot or
  master module.
- Splash shows `MIGRATING SETS n/N` (engine publishes `migp`); one log line per Set.
- In scope: the pre-engpersist layer where chains lived only in `ui-state.json`
  (`chains`/`sends` mirror) — converted into `chains.json`.

## Sources per Set (all keyed by uuid)
| what | path | format |
|---|---|---|
| movy legacy | `schwung/modules/tools/movy/sets/<uuid>/` | seq-state*.json, chains.json, ui-state.json (`chains`,`sends`,`migv`) |
| schwung tracks 1-4 | `schwung/set_state/<uuid>/slot_N.json` | `{name,version,modified,chain:{synth:{module,config:{state}|params,bypassed}, midi_fx:[{type,params,bypassed}], audio_fx:[{type,params,bypassed}], lfos}}` |
| track volume/mute | `schwung/set_state/<uuid>/shadow_chain_config.json` | `{slots:[{volume,muted,...}]}` |
| schwung master | `schwung/set_state/<uuid>/master_fx_0..3.json` | `{module_id,state|params,bypassed,lfos(on _0)}` (see src/chain/master-import.ts) |

## Conversion → `chains.json` (chain_state.rs 6-field records: slot,comp,module,state,mix,lfo)
1. Base = legacy `chains.json`; else legacy ui-state mirror (`chains`→track records, `sends`→bus records).
2. Tracks 0-3: skip all slot conversion if ui-state `migv>=1` (overtake build already
   migrated). Else fill each track with NO base records from `slot_N.json`:
   synth→`synth`, midi_fx[0]→`midi_fx1`, audio_fx[0..1]→`fx1`,`fx2` (fx3+ logged, dropped);
   state = config.state (object → JSON string); params-only → module at defaults, logged;
   bypassed → NOT migrated (keeps the sound), logged. mix = `gain,0.0000,muted,0.0000,0.0000`
   from shadow_chain_config (omit at unity/unmuted). lfo = nested 22-field doc, LFO_KEYS order.
3. Master: if base has no master records → from master_fx files (same rules) + IMPORT_MARK record.
4. Occupied tracks always win over schwung (both modes) — force means "re-copy", not "prefer schwung".

## Engine (Rust, movy-dsp)
- `set_import.rs` → `set_migrate.rs`: enumerate pages, candidates, pure `convert()`, cargo tests
  with fixture dirs (pages, collisions, deleted uuid, migv, mirror-only legacy, bypass, master).
- `LibCmd::Migrate{src, force}` replaces `Import` (`lib migrate legacy= move= pages= state= curpage= [force]`);
  update tests in lib.rs:1520, set_saver.rs:964/999, set_lib_jobs.rs:149.
- Auto: no-op when `migrated != 0`. Existing `imported` uuids: entry present → fill-only
  conversion in place; deleted → skip. New uuids → copy tree + convert.
- Force: per entry: `capture(Why::PreMigrate)`, write payload+chains at gen above all copies
  and versions (Restore arm in set_saver.rs is the model), ui-state.json atomic. Open Set:
  `sh.loaded` + `vui` handback exactly like Restore. Audio thread: flush the open Set before
  a force job (same `carry` as `Dup`, lib.rs ~501).
- Wire header gains `mig=<ms>`; Shared gains `migp`.

## UI (TypeScript)
- `sets-lib.ts` `libMigrateCmd(force)`; `set-lib-session.ts` sends it once per engine gen.
- DELETE `src/chain/master-import.ts` + wiring (engine-status.ts:114, engine.ts:152,
  set-session.ts:219) + its tests — the engine migration owns the master.
- `ui-state.ts applyUiState`: when engpersist and `chains.json` parses (`parseMirror`),
  restore chains/sends from it, not from the blob's mirror (otherwise the stale mirror
  unloads migrated tracks on load). Fallback to `o.chains`.
- Generalise `version-restore.ts` pending/`restoreTick` so a force migrate of the open Set
  re-enters the load (`reloadCurrentSet`).
- ACTION_ROWS += MIGRATE FROM MOVE; flags-page-vm `CONFIRM?`; screenshot baseline update.
- MANUAL.md: Settings row + first-boot migration; CHANGELOG.

## Gates
npm test, cargo test, vdev tier 3; device tier (storage/persistence on real Sets) before release.
