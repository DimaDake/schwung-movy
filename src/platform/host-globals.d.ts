/* Ambient declarations for the movy-host globals movy calls (host/globals*.c).
 * Only src/platform/standalone.ts may name them (browser-test/source-rules.mjs);
 * everything else goes through the Platform interface. */

declare function host_read_file(path: string): string | null;
declare function host_write_file(path: string, content: string): boolean;
declare function host_file_exists(path: string): boolean;
declare function host_ensure_dir(path: string): boolean;
/* rm -rf. There is no host_remove_file, so a directory is the unit of deletion. */
declare function host_remove_dir(path: string): boolean;
declare function host_module_set_param(key: string, value: string): boolean;
declare function host_module_set_param_blocking(key: string, value: string, timeoutMs: number): boolean;
declare function host_module_get_param(key: string): string | null;
/* Bulk param channel: N keys in one round trip, length-prefixed payload (see
 * src/track/bulk.ts). The slot and marker arguments are ignored. */
declare function shadow_get_params(slot: number, key: string, payload: string): string | null;
declare function shadow_set_params(slot: number, key: string, payload: string): boolean;
/* Native LED / surface MIDI: [cin, status, data1, data2], cable 0. */
declare function move_midi_internal_send(data: number[]): void;
/* Evaluates a module's own ui.js canvas in this runtime. */
declare function shadow_load_ui_module(path: string): boolean;
declare function host_exit_module(): void;
/** Leave cleanly, then power the box off (host/power.c). */
declare function host_power_off(): void;
