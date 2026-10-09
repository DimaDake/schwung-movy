/* The one interface between movy's TypeScript and whatever hosts it.
 *
 * Today the host is schwung's shadow_ui with movy overtaking Move; after the
 * standalone switch it is movy-host (plans/2026-10-09-standalone-migration.md).
 * Both run the SAME ui.js, so everything that differs between them lives behind
 * this interface — and `browser-test/source-rules.mjs` fails any host global
 * named outside `src/platform/`.
 *
 * `undefined` from a method means "this host has no such call", which is not
 * the same as a call that answered nothing (`null`) or refused (`false`). The
 * callers that care — the param door above all — tell the three apart. */

import type { Caps } from './caps.js';

export interface Platform {
    readonly name: 'overtake' | 'standalone';
    readonly caps: Caps;

    /* ── files ── */
    /** Both read and write exist — i.e. there is a filesystem at all. */
    filesAvailable(): boolean;
    readFile(path: string): string | null;
    writeFile(path: string, content: string): boolean;
    fileExists(path: string): boolean | undefined;
    ensureDir(path: string): boolean;
    /** rm -rf. There is no file delete, so a directory is the unit. */
    removeDir(path: string): boolean;

    /* ── movy's own engine (the param channel; src/host/param.ts is its door) ── */
    engineAvailable(): boolean;
    engineGet(key: string): string | null | undefined;
    /** Fire-and-forget; `undefined` when the host lacks it. */
    engineSet(key: string, value: string): boolean | undefined;
    /** `false` = refused; `undefined` when the host lacks it. */
    engineSetBlocking(key: string, value: string, timeoutMs: number): boolean | undefined;
    engineGetBulk(payload: string): string | null | undefined;
    engineSetBulk(payload: string): boolean | undefined;

    /* ── chain-host slots, addressed by slot number ── */
    slotParamsAvailable(): boolean;
    slotGet(slot: number, key: string): string | null;
    slotSet(slot: number, key: string, value: string): boolean;
    slotSetTimeout(slot: number, key: string, value: string, timeoutMs: number): boolean | undefined;
    slotSendMidi(data: number[]): void;
    /** The slot the host's own UI had selected when movy opened. */
    uiSlot(): number;

    /* ── surface and lifecycle ── */
    /** Cable-0 MIDI to the hardware: LEDs and their animation channels.
     *  False when the host has no such send. */
    surfaceSend(data: number[]): boolean;
    canLoadUiModule(): boolean;
    /** Load a module's own `ui.js` canvas into this runtime. */
    loadUiModule(path: string): boolean;
    exit(): void;
    /** Park under Move's UI. Only when `caps.canSuspend`. */
    suspend(): void;

    /* ── living beside Move (caps.coexistsWithMove) ── */
    /** Take Move's cable-0 LED sysex away from it; false if the host can't. */
    claimLeds(): boolean;
    /** Hand the surface to Move (true) or take it back; false if the host can't. */
    lendSurfaceToMove(toMove: boolean): boolean;
    /** Keep CC 79 and the master touch from Move; false if the host can't. */
    excludeMoveFromVolume(excluded: boolean): boolean;
    canExcludeMoveFromVolume(): boolean;
    canInjectToMove(): boolean;
    injectToMove(data: number[]): void;
    /** An engine `midi_inject_to_move` really reaches Move (schwung #293). */
    engineInjectReachesMove(): boolean;

    /** Host calls the perf probe times, as [global name, label, key arg]. */
    readonly ipcCalls: readonly (readonly [string, string, number])[];
}
