/* Which master the MASTER page drives, decided once per open.
 *
 * movy's own (`mfx:`) wherever there is no Move beside movy, or when the
 * `mstown` flag asks for it in overtake; schwung's (`master_fx:`) otherwise,
 * so an overtake user sees the page exactly as before. The engine hears the
 * same decision as `mfx:own`: without it the movy master is out of the audio
 * path, and loading FX into it would change nothing anyone can hear.
 *
 * Design: docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md §5.3. */

import { platform } from '../platform/index.js';
import { flagValue } from '../seq/flags.js';
import { MASTER_FX_SLOTS } from './config.js';
import { masterSuffix, MOVY_MASTER_PREFIX, setMasterPrefix, SHIM_MASTER_PREFIX } from './master-prefix.js';

/* A device test's override (the probe's `bindMaster`); null = no override. */
let override: boolean | null = null;
export function setMasterBindingOverride(v: boolean | null): void { override = v; }

export function movyMasterBound(): boolean {
    if (override !== null) return override;
    return !platform.caps.coexistsWithMove || flagValue('mstown') === 1;
}

/** Point the master slots at the bound master. Before any model is built.
 *  In place, so every holder of `MASTER_FX_SLOTS` sees the same keys. */
export function bindMaster(): void {
    bindMasterPrefix(movyMasterBound() ? MOVY_MASTER_PREFIX : SHIM_MASTER_PREFIX);
}

export function bindMasterPrefix(prefix: string): void {
    setMasterPrefix(prefix);
    for (const s of MASTER_FX_SLOTS) {
        const bare = masterSuffix(s.componentKey);
        if (bare !== null) s.componentKey = prefix + bare;
    }
}

/** Tell a (possibly brand new) engine whether its master is in the path. */
export function pushMasterBinding(set: (key: string, value: string) => void): void {
    set('mfx:own', movyMasterBound() ? '1' : '0');
}
