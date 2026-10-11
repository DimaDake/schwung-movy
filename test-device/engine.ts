import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* Walk up to the directory holding package.json. This module is imported from
 * test-device/dist/ at runtime but lives in test-device/ as source, so a fixed
 * number of '..' segments is right in exactly one of those two places. */
export function repoRoot(): string {
    let d = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
        if (existsSync(join(d, 'package.json'))) return d;
        d = dirname(d);
    }
    throw new Error('repo root not found above ' + fileURLToPath(import.meta.url));
}

export type EngineDeploy =
    | { built: true; changed: boolean; restarted: boolean; detail: string }
    | { built: false; detail: string };

/* The engine's test-only silence, and WHEN it can be applied.
 *
 * `mute` is a process static inside dsp.so, so one write holds for the rest of
 * that dlopen — across the instance churn a scenario's close-and-reopen causes.
 * But it can only be written once the .so is actually loaded, and at the top of
 * a sweep nothing is: the stack has just been restarted and movy has not been
 * opened yet. Setting it there reported COULD NOT MUTE and the sweep played out
 * loud, which is how this ended up here instead.
 *
 * So the intent is recorded once and applied by `Device.open()` — after its
 * ready wait, never during the restore, because a param write in that window is
 * the documented way to starve the restore itself. Re-applied on every open
 * rather than once: a reopen re-dlopens, which resets the static. */
let wantMute = false;

export function setRunMute(on: boolean): void { wantMute = on; }

export async function applyRunMute(tx: { engineSet(k: string, v: string): Promise<void> }): Promise<void> {
    if (!wantMute) return;
    try { await tx.engineSet('mute', '1'); } catch { /* audible, not fatal */ }
}
