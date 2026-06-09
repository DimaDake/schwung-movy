import type { ModuleConfig } from '../types/param.js';
import plaitsJson from './plaits.json';
import wurlJson   from './wurl.json';
import moogJson   from './moog.json';

const MOVY_SG_ROOT = '/data/UserData/schwung/modules/sound_generators';

const CONFIGS: Record<string, ModuleConfig> = {
    plaits: plaitsJson as unknown as ModuleConfig,
    wurl:   wurlJson   as unknown as ModuleConfig,
    moog:   moogJson   as unknown as ModuleConfig,
};

function tryFile(path: string): ModuleConfig | null {
    if (typeof host_read_file !== 'function') return null;
    try {
        const s = host_read_file(path);
        if (s) return JSON.parse(s) as ModuleConfig;
    } catch {}
    return null;
}

export function loadModuleConfig(moduleId: string): ModuleConfig | null {
    if (!moduleId) return null;
    return tryFile(`${MOVY_SG_ROOT}/${moduleId}/movy_config.json`)
        ?? CONFIGS[moduleId]
        ?? null;
}
