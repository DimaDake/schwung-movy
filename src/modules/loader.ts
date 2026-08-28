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
import slicerJson      from './slicer.json';

const MOVY_MODULE_ROOT = '/data/UserData/schwung/modules';

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
    slicer:          slicerJson       as unknown as ModuleConfig,
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

/* A module can ship its own layout: `movy_config.json` in its module directory
 * is read at load time, so a module is fully self-describing with no movy-side
 * config (e.g. Forge). Bundled CONFIGS cover modules that don't ship one. */
function componentCategory(componentKey: string): string {
    if (componentKey === 'synth') return 'sound_generators';
    if (componentKey.startsWith('midi_fx')) return 'midi_fx';
    return 'audio_fx'; // track FX and master_fx:fxN
}

/* The module's own manifest, as JSON — the file schwung's chain host reads for
 * the slot's param table. */
export function loadModuleJson(moduleId: string, componentKey = 'synth'):
    { capabilities?: { ui_hierarchy?: unknown } } | null {
    if (!moduleId) return null;
    if (typeof host_read_file !== 'function') return null;
    try {
        const raw = host_read_file(
            `${MOVY_MODULE_ROOT}/${componentCategory(componentKey)}/${moduleId}/module.json`);
        if (raw) return JSON.parse(raw) as { capabilities?: { ui_hierarchy?: unknown } };
    } catch {}
    return null;
}

export function loadModuleConfig(moduleId: string, componentKey = 'synth'): ModuleConfig | null {
    if (!moduleId) return null;
    return tryFile(`${MOVY_MODULE_ROOT}/${componentCategory(componentKey)}/${moduleId}/movy_config.json`)
        ?? CONFIGS[moduleId]
        ?? null;
}
