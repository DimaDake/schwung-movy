/* Ambient declarations for the host globals movy calls. Only src/platform/ may
 * name them (browser-test/source-rules.mjs); everything else goes through the
 * Platform interface. Most may be absent on older hosts and in the browser
 * suites, so every use is guarded with typeof. */

declare function shadow_get_param(slot: number, key: string): string | null;
declare function shadow_set_param(slot: number, key: string, value: string): boolean;
/* Blocking variant: waits (up to timeoutMs) for the write to be consumed. The
 * overtake param SHM is a single slot, so consecutive non-blocking writes
 * overwrite each other — multi-field commits (e.g. LFO target+param+enabled)
 * must use this. May be absent in older shims / test env → guard with typeof. */
declare function shadow_set_param_timeout(slot: number, key: string, value: string, timeoutMs: number): boolean;
/* Bulk param channel (shadow_ui.c request types 3/4): collapses N round trips
 * into one and routes to the loaded overtake DSP — for movy, its own engine.
 * `key` is the routing marker ("overtake_dsp:"); the payload is length-prefixed
 * (see src/track/bulk.ts). Absent on older shims → guard with typeof. */
declare function shadow_get_params(slot: number, key: string, payload: string): string | null;
declare function shadow_set_params(slot: number, key: string, payload: string): boolean;
declare function shadow_get_ui_slot(): number;
declare function shadow_send_midi_to_dsp(data: number[]): void;
declare function host_exit_module(): void;
/** movy-host only: leave cleanly, then power the box off (host/power.c). */
declare function host_power_off(): void;
/* Strip Move's cable-0 RGB LED sysex during full overtake. Absent on hosts
 * older than the flag; the framework clears it on overtake exit. */
declare function shadow_set_overtake_suppress_sysex(flag: number): void;
/* Suppress CC 79 (master volume) / master-touch note 8's hardcoded overtake
 * passthrough to Move firmware, and the matching plain-volume-touch OLED
 * handoff, for the duration a tool sets. Absent on hosts older than the flag
 * (2026-08-24 fork PR) — always guard with `typeof ... === 'function'`. */
declare function shadow_set_overtake_suppress_master_volume(flag: number): void;
/* Capability sentinel (schwung #293, 2026-08-27): returns 1 when an overtake
 * DSP's `midi_inject_to_move` goes out on a dedicated queue that reaches Move
 * while the takeover is live. ABSENT on older hosts, where the shared ring is
 * instead drained back onto the overtaking tool's own surface — see
 * seq/engine.ts (the play link) for what that costs. */
declare function shadow_overtake_move_inject_active(): number;
/* Background mode (Phase 2). host_suspend_overtake() parks movy under Move's
 * native UI; it is ABSENT on hosts that predate the capability, so always
 * guard with `typeof host_suspend_overtake === 'function'`. overtakeParked is
 * set true by the host only while a parked module's tick() runs — read it as
 * `globalThis.overtakeParked` (a bare unset global identifier throws). */
declare function host_suspend_overtake(): void;
declare function host_read_file(path: string): string | null;
declare function host_write_file(path: string, content: string): boolean;
declare function host_file_exists(path: string): boolean;
declare function host_ensure_dir(path: string): boolean;
/* rm -rf, permitted only under modules/ — which is where movy's per-set state
 * lives. There is no host_remove_file, so a directory is the unit of deletion. */
declare function host_remove_dir(path: string): boolean;
/* Tool-DSP param bridge — installed by shadow_ui before ui.js loads when the
 * tool ships a dsp.so (routes to shadow_set/get_param(0, "overtake_dsp:"+key)).
 * Guard with typeof checks: absent in browser tests and DSP-less installs. */
declare function host_module_set_param(key: string, value: string): boolean;
declare function host_module_set_param_blocking(key: string, value: string, timeoutMs: number): boolean;
declare function host_module_get_param(key: string): string | null;
/* Native LED / surface MIDI: [cin, status, data1, data2]. A shadow_ui global
 * available to overtake modules; used to drive Push-2-style LED animation
 * channels. Absent in browser tests (guard with typeof). */
declare function move_midi_internal_send(data: number[]): void;

/* Inject USB-MIDI packets ([cin, status, d1, d2], cable 0 = control surface)
 * into Move firmware's MIDI_IN. The shim drains these after all overtake
 * filtering, so they reach Move even while it is blocked from the hardware.
 * Absent in browser tests (guard with typeof). */
declare function move_midi_inject_to_move(data: number[]): void;
/* 0 = normal (Move owns the surface), 1 = menu, 2 = module. Lowering it is the
 * only way a packet injected by a module can reach Move — see seq/set-commit.ts. */
declare function shadow_set_overtake_mode(mode: number): void;
/* Evaluates a module's own ui.js canvas in this runtime. */
declare function shadow_load_ui_module(path: string): boolean;
/* Defined by movy-host (the standalone flavour) before ui.js evaluates;
 * absent under shadow_ui. Its presence is how src/platform picks a host. */
declare const movy_host: { flavour: string; version: string; schwung: string; movy: string } | undefined;
