import type { ModuleConfig } from '../types/param.js';
import plaitsJson      from './plaits.json';
import wurlJson        from './wurl.json';
import mrdrumsJson     from './mrdrums.json';
import weirdDreamsJson from './weird-dreams.json';
import krautdrumsJson  from './krautdrums.json';
import libpo32Json     from './libpo32.json';
import essaimJson      from './essaim.json';
import chordismJson    from './chordism.json';
import sfzJson         from './sfz.json';
import s303Json        from './303.json';
import chiptuneJson    from './chiptune.json';
import hush1Json       from './hush1.json';
import signalJson      from './signal.json';

const MOVY_SG_ROOT = '/data/UserData/schwung/modules/sound_generators';

const CONFIGS: Record<string, ModuleConfig> = {
    '303':           s303Json         as unknown as ModuleConfig,
    chiptune:        chiptuneJson     as unknown as ModuleConfig,
    chordism:        chordismJson     as unknown as ModuleConfig,
    essaim:          essaimJson       as unknown as ModuleConfig,
    hush1:           hush1Json        as unknown as ModuleConfig,
    signal:          signalJson       as unknown as ModuleConfig,
    krautdrums:      krautdrumsJson   as unknown as ModuleConfig,
    mrdrums:         mrdrumsJson      as unknown as ModuleConfig,
    plaits:          plaitsJson       as unknown as ModuleConfig,
    'po32-drum':     libpo32Json      as unknown as ModuleConfig,
    sfz:             sfzJson          as unknown as ModuleConfig,
    'weird-dreams':  weirdDreamsJson  as unknown as ModuleConfig,
    wurl:            wurlJson         as unknown as ModuleConfig,
};

function tryFile(path: string): ModuleConfig | null {
    if (typeof host_read_file !== 'function') return null;
    try {
        const s = host_read_file(path);
        if (s) return JSON.parse(s) as ModuleConfig;
    } catch {}
    return null;
}

/* A module can ship its own layout: `movy-layout.json` in its module directory
 * is read at load time, so a module is fully self-describing with no movy-side
 * config (e.g. Forge). `movy_config.json` is the older per-module filename, kept
 * as a fallback; bundled CONFIGS cover modules that don't ship a layout. */
export function loadModuleConfig(moduleId: string): ModuleConfig | null {
    if (!moduleId) return null;
    return tryFile(`${MOVY_SG_ROOT}/${moduleId}/movy-layout.json`)
        ?? tryFile(`${MOVY_SG_ROOT}/${moduleId}/movy_config.json`)
        ?? CONFIGS[moduleId]
        ?? null;
}
