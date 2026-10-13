/* The one interface between movy's TypeScript and movy-host.
 *
 * movy-host (host/) is the only host since WP9 deleted the overtake one
 * (plans/2026-10-09-standalone-migration.md). The seam stays because it is
 * what the suites swap, and `browser-test/source-rules.mjs` fails any host
 * global named outside `src/platform/standalone.ts`. */

export interface EngineSnapshot {
    seq: number;
    served: number;
    text: string;
}

export interface Platform {
    /* ── files ── */
    readFile(path: string): string | null;
    writeFile(path: string, content: string): boolean;
    fileExists(path: string): boolean;
    ensureDir(path: string): boolean;
    /** rm -rf. There is no file delete, so a directory is the unit. */
    removeDir(path: string): boolean;

    /* ── movy's own engine (the param channel; src/host/param.ts is its door) ── */
    /** Waits for the engine's answer (the next frame boundary). */
    engineGet(key: string): string | null;
    /** Queued in order and never lost; `false` only when no engine is loaded. */
    engineSet(key: string, value: string): boolean;
    engineGetBulk(payload: string): string | null;
    /** Queued like engineSet. */
    engineSetBulk(payload: string): boolean;
    /** The engine's `status`, published after every render (host/status_snap.h):
     *  how many have been published (0 = none), cheap enough for every tick. */
    engineSnapshotSeq(): number;
    /** The latest published status, and the requests serviced before it. */
    engineSnapshot(): EngineSnapshot | null;
    /** Requests queued so far: a snapshot whose `served` reaches it reflects
     *  every request made before this call. */
    engineSubmitted(): number;

    /* ── surface and lifecycle ── */
    /** Cable-0 MIDI to the hardware: LEDs and their animation channels. */
    surfaceSend(data: number[]): void;
    /** Load a module's own `ui.js` canvas into this runtime. */
    loadUiModule(path: string): boolean;
    exit(): void;
    /** Leave cleanly, then power the box off (host/power.c). */
    powerOff(): void;

    /** Host calls the perf probe times, as [global name, label, key arg]
     *  (-1 = the call takes no key). */
    readonly ipcCalls: readonly (readonly [string, string, number])[];
}
