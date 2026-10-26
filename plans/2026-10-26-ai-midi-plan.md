# AI MIDI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smart Quantize (Shift + hold Step 16) and Generate Variation (Shift + Step 14): movy sends the Set's MIDI to Gemini/OpenAI and previews three AI options + ORIG for one clip.

**Architecture:** Pure TS modules under `src/ai/` build the request from engine read-backs, validate the reply and own the preview state machine; the HTTP call is Schwung's `host_http_request_background` (curl in a child, polled from `tick`). The Rust engine gains a per-track clip dump (get) and an atomic replace-clip command, so the engine stays the single owner of clip truth. Undo wraps the whole job in one held group.

**Tech Stack:** TypeScript (QuickJS, esbuild), Rust `seq-core` / `movy-dsp`, Schwung per-module settings (`settings-schema.json`, `secrets/`).

**Spec:** `movy/plans/2026-10-26-ai-midi-design.md` (read it first; § refs below point there).

## Global Constraints

- Branch `feature/ai-midi`; commit per task; push at the end of each task.
- 200-line hard limit per `src/` file (target 50–100). No display calls outside `renderer/` / `*-render.ts` / `*-page.ts` view files.
- `src/platform/standalone.ts` is the ONLY file naming host globals; regenerate `browser-test/host-globals.json` with `SCHWUNG=../schwung node scripts/host-globals.mjs --write`.
- `ENGINE_VERSION` bumped once (engine task) in both `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts`.
- Engine param value cap is `PQ_VALUE_CAP = 131072` bytes (host/param_queue.h) — every get/set payload stays under it.
- No per-tick cost when no AI job is active (perf.mjs must not move).
- Three options + ORIG, always; option 1 = closest, 3 = most inventive (§2, §3).
- Drum quantize option 1 never changes a pad; options 2–3 may, only to kit pads (§2, §6.3).
- MIDI FX never read or written (§1 non-goals).
- Whole Set sent; duplicate clips on a track sent once; ~400 KB hard ceiling → non-target/source scenes shrink to harmony summary (§9).
- Error copy exactly: `NO API KEY — MOVE.LOCAL:7700`, `NO NETWORK`, `AI BUSY, TRY LATER`, `AI ERROR`, `NOTHING TO QUANTIZE`. Running labels `QUANTIZING…`, `VARIATION…`. Strip: `AI  ORIG  1  2  3`.
- Hold timing: 300 ms invisible, then fill to full at 1300 ms. Pad animation step = 700 ms (power-off's `POWEROFF_STEP_FRAMES 240` × 2.9 ms), hardware fade channel 4.

## Review Focus

1. **Shift released before Step 16** (or Step 16 released after Shift) — a hold already past 300 ms must still cancel cleanly, no quantize cycle fires. → Task 8 test `hold16_shift_released_first_cancels`.
2. **Reply arrives after Back-cancel** (curl child keeps running) — a late status file must be ignored, no preview opens. → Task 6 test `late_reply_after_cancel_ignored`.
3. **Set switched / movy Set load while running or previewing** — job must abort (running) or commit (preview) before the engine applies another Set. → Task 6 test `set_change_aborts_running_commits_preview`.
4. **Model returns notes in a different time base** (beats vs ticks, 1-based bars) or empty options — validator repairs/rejects, never writes garbage. → Task 4 tests `rejects_out_of_clip_notes`, `drops_empty_option`.
5. **Recording armed when the job starts** — Smart Quantize/Variation refuse while `rec` is on (toast `AI ERROR` not shown; gesture simply ignored). → Task 8 test `ai_gestures_ignored_while_recording`.

---

### Task 1: Engine — clip dump get + replace-clip command

**Files:**
- Modify: `engine/crates/seq-core/src/command.rs` (new verb `aiclip`, add to the undoable-edit list, NOT to the non-undoable list at ~l.130)
- Create: `engine/crates/seq-core/src/engine/ai_clip.rs` (+ `mod ai_clip;` in `engine/mod.rs` or wherever `note_view` is declared)
- Modify: `engine/crates/movy-dsp/src/lib.rs` get_param (~l.692): prefix key `ait:<t>`
- Modify: `engine/crates/movy-dsp/src/lib.rs` + `src/seq/constants.ts` ENGINE_VERSION (minor bump)
- Test: unit tests inside `ai_clip.rs`

**Interfaces:**
- Produces (wire):
  - get `ait:<t>` → one line per non-empty clip slot of track t:
    `<slot> <len_steps> <loop_start> <scale_num>/<scale_den> <transpose> <quant>|<tick>.<gate>.<pitch>.<vel>,...` lines joined by `\n`; pitches are STORED (untransposed); empty track → `""`.
  - cmd `aiclip <t> <slot> <len_steps> <scale_num> <scale_den> <quant> <notes>` where `<notes>` is one token `tick.gate.pitch.vel,...` (may be `-` for none). Replaces that slot's notes, sets length (loop_start 0, loop = whole clip), scale, quant; clears `locks` and `trigs`; step anchor = `round(tick / TICKS_PER_STEP)` clamped to the clip; `suppress=false`. Creates the clip if the slot is empty. Out-of-range values clamp (gate ≥1, vel 1..127, tick < len).
- Produces (Rust): `Engine::ai_track_dump(&self, t: usize) -> String`, `Engine::ai_replace_clip(&mut self, t, slot, len, num, den, quant, notes: &[(u32,u32,u8,u8)])`.

- [ ] **Step 1: failing tests** in `ai_clip.rs`: `dump_lists_only_nonempty_slots`, `dump_roundtrips_through_replace` (dump → parse → replace into another slot → equal notes/len/scale), `replace_creates_empty_slot_clip`, `replace_clears_locks_and_trigs`, `replace_clamps_out_of_range` (tick ≥ len dropped, gate 0 → 1, vel 0 → 1), `replace_is_one_undo` (usnap; aiclip; uswap restores prior notes), `dump_under_value_cap` (16 bars × 512 notes/clip × 8 slots stays < 131072 bytes — if not, the test documents the max and the TS side must request per-track, which it does).
- [ ] **Step 2:** `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test ai_clip` → FAIL (unresolved).
- [ ] **Step 3:** implement; `aiclip` parses the notes token itself (the generic `next()` only reads i64). Wire `ait:` in get_param with `k if k.starts_with("ait:")`.
- [ ] **Step 4:** `cargo test` (whole workspace) → PASS. `./scripts/build-dsp.sh` → builds (version check passes).
- [ ] **Step 5:** commit `engine: ait:<t> clip dump and aiclip replace-clip command (ENGINE x.y.0)`.

### Task 2: Settings, key reading, HTTP platform seam

**Files:**
- Create: `settings-schema.json` (repo root of movy; ships in the tarball)
- Modify: `scripts/build-module.sh` (~l.57 copy list) and `scripts/deploy.sh` (scp it); assert tarball does NOT contain `config.json` or `secrets/`
- Modify: `src/platform/platform.ts`, `src/platform/standalone.ts`, `src/platform/host-globals.d.ts`, `browser-test/host-globals.json` (regenerated)
- Create: `src/ai/config.ts`
- Test: `browser-test/logic/ai-config.mjs` (+ two runner lines in `browser-test/logic.mjs`)

**Interfaces:**
- Schema items (id `movy`, label `Movy AI`): `provider` enum `["Gemini","OpenAI"]`/values `["gemini","openai"]` default `gemini`; `gemini_api_key` password, `help_url` `https://aistudio.google.com/apikey`, help `Free key from Google AI Studio`; `openai_api_key` password; `model` string default `gemini-2.5-flash` (OpenAI default used when provider=openai and model still the Gemini default: `gpt-4.1-mini`).
- `Platform.httpStart(o: {url: string; method: 'POST'; headers: string[]; bodyPath: string; responsePath: string; statusPath: string; timeoutS: number}): boolean` → `host_http_request_background({...})` with snake_case keys.
- `config.ts`: `export interface AiConfig { provider: 'gemini'|'openai'; model: string; key: string }`; `export function readAiConfig(moduleDir: string): AiConfig | null` (null = no key for the chosen provider). Reads `<dir>/config.json` + `<dir>/secrets/<provider>_api_key.txt` (trimmed) via `platform.readFile`.
- Module dir constant: reuse the existing movy module-dir constant (grep `tools/movy` in `src/`), do not add a second literal.

- [ ] **Step 1: failing tests** `ai_config_reads_gemini_key`, `ai_config_null_without_key`, `ai_config_openai_default_model`, `ai_config_ignores_whitespace_key`.
- [ ] **Step 2:** `npm run build:browser && node browser-test/logic.mjs` → FAIL.
- [ ] **Step 3:** implement; regenerate host-globals manifest.
- [ ] **Step 4:** `npm test` → PASS (host-globals suite proves movy-host answers `host_http_request_background`).
- [ ] **Step 5:** commit.

### Task 3: Set context serializer + harmony summary

**Files:**
- Create: `src/ai/clip-dump.ts` (parse `ait:` lines → `AiClip[]`), `src/ai/harmony.ts`, `src/ai/context.ts`
- Test: `browser-test/logic/ai-context.mjs`

**Interfaces:**
- `export interface AiNote { tick: number; gate: number; pitch: number; vel: number }`
- `export interface AiClip { track: number; slot: number; len: number; loopStart: number; scaleNum: number; scaleDen: number; transpose: number; quant: number; notes: AiNote[] }`
- `parseTrackDump(track: number, s: string): AiClip[]`
- `sceneHarmony(clips: AiClip[], drum: (t: number) => boolean, rootPc: number, mode: string): string[]` — per bar: sounding pitch classes (transpose applied) + best triad/7th name or `-`.
- `buildContext(input: AiContextInput): string` where `AiContextInput = { bpm; swing; root; mode; tracks: { index; name; module; drum; padNames: string[] | null; clips: AiClip[] }[]; target: { track; slot }; source: { track; slot } | null; ceilingBytes?: number }`.
  - Text format (builder's exact words, but these facts): header (tempo, swing, key, 4/4, 16 steps/bar, 96 PPQN → 24 ticks/step), per track a role line, per clip `scene N (len B bars, speed n/d, transpose t)` then notes as `bar.beat.16th+ticks dur NOTE vel` (NOTE = `C#3` melodic, pad name or `pad k (guessed: KICK)` drum), duplicates as `scene 4: same as scene 2`, target/source flagged `[TARGET]` / `[SOURCE]`, then `HARMONY` section per scene.
  - Drum fallback names (pad index from bottom-left, Move kit order): `KICK, SNARE, CLOSED HAT, OPEN HAT, CLAP, TOM LOW, TOM HIGH, RIM, …` — `pad k` beyond the list.
  - Over `ceilingBytes` (default 400_000): scenes other than target/source emit only their HARMONY line.

- [ ] **Step 1: failing tests** `parse_track_dump_roundtrip`, `duplicates_sent_once` (two identical clips → one note list + `same as`), `drum_names_declared_vs_guessed`, `harmony_c_major_bar` (C-E-G → `C`), `target_and_source_flagged`, `ceiling_shrinks_other_scenes_not_target`, `transpose_applied_in_harmony_not_in_notes`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS. **Step 5:** commit.

### Task 4: Prompt, response schema, validator

**Files:**
- Create: `src/ai/prompt.ts`, `src/ai/validate.ts`
- Test: `browser-test/logic/ai-validate.mjs`

**Interfaces:**
- `export type AiTask = 'quantize' | 'variation'`
- `buildPrompt(task: AiTask, context: string, target: { len: number; drum: boolean }): { system: string; user: string }` — states the creativity ladder (§2 table / §3), "at least one variation option changes the harmony" (variation, melodic), drum rules, ticks time base (24 ticks/step, tick < len×24), and the JSON schema below.
- Reply JSON: `{"options":[{"label":"short","notes":[[tick,gate,pitch,vel],...],"moved":["reason",...]}, ×3]}`.
- `validateOptions(raw: string, ctx: { task: AiTask; len: number; drum: boolean; original: AiNote[]; kitPads: number[] }): AiNote[][]` — returns 0–3 repaired note lists:
  - strip ``` fences; JSON.parse failure → `[]`;
  - drop notes with tick ∉ [0, len×24); gate → [1, len×24−tick]; pitch/vel clamp 0..127 / 1..127; cap 1024 notes/option;
  - drum quantize option index 0: every note's pitch must be in the original pitch set, else snapped to the original note nearest in time; options 1–2: pitch ∉ kitPads → dropped;
  - empty option dropped; identical options deduped.

- [ ] **Step 1: failing tests** `rejects_out_of_clip_notes`, `drops_empty_option`, `strips_code_fences`, `drum_quant_option1_keeps_pads`, `drum_option3_drops_non_kit_pad`, `dedupes_identical_options`, `prompt_mentions_harmony_option_for_variation`.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** commit.

### Task 5: Provider requests + HTTP job

**Files:**
- Create: `src/ai/provider.ts` (request/response shapes), `src/ai/http-job.ts` (start/poll/cancel)
- Test: `browser-test/logic/ai-provider.mjs`

**Interfaces:**
- `buildRequest(cfg: AiConfig, p: { system: string; user: string }): { url: string; headers: string[]; body: string }`
  - Gemini: `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`, header `x-goog-api-key: <key>`, body with `systemInstruction`, `contents`, `generationConfig: { responseMimeType: 'application/json', temperature: 1.0 }`.
  - OpenAI: `https://api.openai.com/v1/chat/completions`, `Authorization: Bearer <key>`, `response_format: { type: 'json_object' }`.
- `extractText(cfg, responseBody: string): string | null`.
- `classifyStatus(http: number, curlExit: number): 'ok' | 'NO NETWORK' | 'AI BUSY, TRY LATER' | 'AI ERROR'` (curl exit 6/7/28 → network; 429/503 → busy; other non-2xx → error).
- `http-job.ts`: `startHttp(req): number` (job id; files under `/data/UserData/UserLibrary/Movy/.ai/<id>.{body,resp,status}`, dir via `platform.ensureDir`), `pollHttp(id): null | { http: number; curlExit: number; body: string }` (reads status file; null while absent), `cancelHttp(id)` (marks id dead; later poll returns null forever; files removed on next start).
- Dev seam: if `<moduleDir>/ai-fake-response.json` exists, `startHttp` copies it into the response/status files instead of calling the host (vdev/device scenarios; never shipped).

- [ ] **Step 1: failing tests** `gemini_request_shape`, `openai_request_shape`, `extract_text_gemini`, `classify_429_busy`, `classify_curl_timeout_network`, `poll_null_until_status_file`, `late_reply_after_cancel_ignored`, `fake_response_bypasses_host`.
- [ ] **Step 2–4.** **Step 5:** commit.

### Task 6: Job state machine, running screen, thinking LEDs

**Files:**
- Create: `src/ai/job.ts` (state machine), `src/ai/target.ts` (source/target selection), `src/ai/running-render.ts`, `src/ai/thinking-leds.ts`
- Modify: `src/midi/router.ts` (first-look before the `leaveModalActive()` block ~l.261), `src/app/tick.ts` (one `aiTick(now)` call; early-return cost when idle), LED painter (`src/seq/leds.ts` `seqLedsTick`) to yield while running
- Test: `browser-test/logic/ai-job.mjs`; screenshots `ai_running_quant`, `ai_running_var`, `ai_error_nokey`

**Interfaces:**
- `target.ts`: `pickSource(slots: { slot: number; hasNotes: boolean }[], target: number): number | null` (nearest above, else nearest below, never target); `variationTarget(clips, targetSlot, sourceSlot): { len; scaleNum; scaleDen }` (existing target clip's len if any, else source's; scale always source's).
- `job.ts`: `type AiPhase = 'idle' | 'running' | 'preview'`; `aiPhase(): AiPhase`; `startAiJob(task: AiTask, track: number, slot: number): void` (reads config → error toast + return if null; reads all `ait:` dumps spread one track per tick; per-track module id/name from the engine's `chains` get and drum pad names through `src/chain/hierarchy-source.ts` — the one reader of a module's contract, never a new `loadModuleJson()`; drum = `trackIsDrum(t)`; opens the held undo group (Task 7); builds prompt; `startHttp`); `aiTick(now: number): void`; `aiCancel(): void` (Back while running); on a valid reply → `openPreview(options)` (Task 7); on failure → `seqToast(<copy>)`, phase idle, group abandoned (`abandonGroup`).
- Abort rules: Set change (`currentSetUuid()` differs from job start) while running → `aiCancel()`; while preview → commit (Task 7 `commitPreview()`).
- Router while running: swallow everything except Back (Back → `aiCancel`). LEDs while running: all off except Back (white); pads = `thinkingPadColour(pad: number, step: number): number` — violet→white band, one column wide, sweeping left→right across 8 columns, one column per 700 ms step, sent on channel 0 then the fade channel 4 like `host/poweroff_show.c`; respect the existing per-tick LED budget in `led-cache`.
- Running screen: label + animated progress dots/bar; elapsed seconds.

- [ ] **Step 1: failing tests** `pick_source_prefers_above`, `pick_source_below_when_none_above`, `pick_source_null_alone`, `variation_len_from_existing_target`, `variation_scale_from_source`, `no_key_toasts_and_stays_idle`, `back_cancels_running`, `late_reply_after_cancel_ignored` (job level), `set_change_aborts_running_commits_preview`, `running_swallows_pads_and_steps`, `thinking_band_moves_one_column_per_step`, `idle_tick_costs_nothing` (perf counter unchanged).
- [ ] **Step 2–4;** `node browser-test/screenshot.mjs --update` for the three new scenes, inspect PNGs.
- [ ] **Step 5:** commit.

### Task 7: Preview — options, per-option edits, commits, undo

**Files:**
- Create: `src/ai/preview.ts` (state), `src/ai/preview-render.ts` (strip), `src/ai/preview-input.ts` (jog)
- Modify: `src/undo/group.ts` (held group), `src/seq/note-view.ts` (`noteViewActive() || aiPhase()==='preview'`), router first-look (jog turn/click)
- Test: `browser-test/logic/ai-preview.mjs`; screenshots `ai_preview_orig`, `ai_preview_opt1`, `ai_preview_opt3`

**Interfaces:**
- `group.ts`: `holdGroup(key: string): void` — while held, `beginEdit` with any other key joins the held group and no close policy (idle/touch/loop-wrap) closes it; `releaseHold(commit: boolean): void` → commit closes it as one entry (verb from the job: `AI QUANT` / `AI VARIATION`), false → `abandonGroup()` after restoring nothing.
- `preview.ts`: `openPreview(job: { track; slot; task; orig: AiClip; options: AiNote[][]; len; scaleNum; scaleDen; origQuant })`; `previewIndex(): number` (0 = ORIG, 1–3); `previewSwitch(delta: number)` (clamped, no wrap; before leaving reads the clip back via `ait:<t>` into the current index's slot; writes the new one with `aiclip`; AI options use quant 0, ORIG its own quant/len/scale/notes); `commitPreview()`; per-tick watcher: commit when `watchedTrack()`, the track's selected slot, `appState.currentView`, `seqState.sessionMode` or `seqState.loopMode` changes from the values at open.
- Opens on index 1. Strip: `AI  ORIG  1  2  3` in the TOAST band, current boxed (reuse `drawSongBand`'s token/box drawing by extracting a shared `drawBandTokens(lead: string, tokens: {label; current}[])` from `render.ts`, then `drawSongBand` uses it too).
- Router: jog turn → `previewSwitch(decodeDelta(v))`; jog click → `commitPreview()`; Back → `commitPreview()` then normal Back is NOT executed; everything else passes through (editing allowed).
- Knobs idle during preview (as Loop note view).

- [ ] **Step 1: failing tests** `opens_on_option1`, `switch_writes_aiclip_with_quant0`, `orig_restores_quant_len_scale`, `edits_kept_per_option` (edit opt2 → switch 3 → back 2 → edited notes rewritten), `jog_click_commits`, `back_commits_not_exits`, `track_switch_commits`, `clip_switch_commits`, `view_change_commits`, `song_advance_does_not_commit`, `undo_after_commit_restores_pre_ai_clip_in_one_step` (one entry on the stack, uswap target = pre-job snapshot), `drawSongBand_unchanged` (existing song screenshots identical).
- [ ] **Step 2–4;** screenshots `--update`, inspect.
- [ ] **Step 5:** commit.

### Task 8: Gestures — Shift + hold Step 16, Shift + Step 14

**Files:**
- Modify: `src/seq/constants.ts` (`STEP_AI_VARIATION = 13` 0-indexed), `src/seq/step-shortcuts.ts`, `src/seq/router-steps.ts` (~l.135: Step 16 moves to press/release handling), `src/seq/leds.ts` (Step 14 dim white under Shift when `variationPossible()`)
- Create: `src/ai/hold16.ts` (hold timer + progress), `src/ai/hold-render.ts` (bar)
- Test: `browser-test/logic/ai-gestures.mjs`; screenshot `ai_hold_progress_50`

**Interfaces:**
- `hold16Press(now)`, `hold16Release(now): 'quantize' | 'cancel' | 'none'` (< 300 ms → `quantize`, i.e. `cycleQuantize()` fires on RELEASE; ≥ 300 ms and < 1300 ms → `cancel`); `hold16Tick(now)` (≥ 1300 ms → `startAiJob('quantize', …)` once; progress = (now−300)/1000 drawn only after 300 ms); Shift released mid-hold → `cancel`.
- Shift + Step 14 (Track view only, not in Session view, not while recording): `startAiJob('variation', watchedTrack(), selectedSlot)` if `variationPossible()` = the track has a clip with notes in another slot; otherwise nothing.
- Smart Quantize precondition: selected clip has notes, else toast `NOTHING TO QUANTIZE`. Both gestures ignored while recording or count-in.
- Session view keeps Step 16's plain-tap quantize via `shiftStepFunction` (no AI there).

- [ ] **Step 1: failing tests** `tap16_fires_quantize_on_release`, `hold16_under_300_no_progress_drawn`, `hold16_release_mid_cancels_no_quantize`, `hold16_shift_released_first_cancels`, `hold16_full_starts_job_once`, `step14_led_dim_white_only_when_possible`, `step14_starts_variation`, `step14_inert_in_session`, `ai_gestures_ignored_while_recording`, `quantize_empty_clip_toasts`.
- [ ] **Step 2–4;** screenshot `--update`.
- [ ] **Step 5:** commit.

### Task 9: Integration scenario, docs, gates, deploy

**Files:**
- Create: `test-device/scenarios/ai.ts` (uses the `ai-fake-response.json` seam: push fake file, hold Shift+Step16 1.5 s, assert preview strip via display, jog to 3, click, assert clip notes via `ait:`; Shift+Step14 on an empty slot below a clip → preview → Back → committed)
- Modify: `MANUAL.md` (new "AI" section: gestures, preview controls, key setup at `move.local:7700/modules/movy`, what is sent where; Controls rows for Shift + hold Step 16 and Shift + Step 14), `README.md` (one bullet + `docs/assets/ai_preview_opt1.png`), `CHANGELOG.md`
- Run: `node scripts/make-doc-assets.mjs ai_preview_opt1 ai_running_quant ai_hold_progress_50`

- [ ] **Step 1:** write scenario; `scripts/vdev.sh tier 3` → GREEN.
- [ ] **Step 2:** `npm test` → 0 failures; `(cd engine && cargo test)` → pass; `node browser-test/perf.mjs` unchanged.
- [ ] **Step 3:** device tier required (new host global + LED animation): `./scripts/run-gate.sh device` → GREEN (or DEVICE OFFLINE in CAPS).
- [ ] **Step 4:** real-API smoke, opt-in and manual: with a real Gemini key on the device, one quantize + one variation; record latency and reply size in the commit message. Not a gate.
- [ ] **Step 5:** `./scripts/deploy.sh`; commit docs; push.
