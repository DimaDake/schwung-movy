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
/* The 808/909-family kits. Bundled rather than left to the modules because
 * their shipped configs put a pad on every bank — see supersedesModuleFile. */
import k6w6Json        from './6w6.json';
import k8w8Json        from './8w8.json';
import k9w9Json        from './9w9.json';
import kcw78Json       from './cw78.json';

const MOVY_MODULE_ROOT = '/data/UserData/schwung/modules';

/* Modules whose SHIPPED movy_config.json is outdated or broken, so movy's
 * bundled copy is used INSTEAD of it rather than as a fallback.
 *
 * The default is the other way round — a module that describes itself is
 * authoritative — and that stays right for forge and libpo32, whose own files
 * are the newest thing about them. libpo32 is bundled AND self-describing, so
 * it is exactly what a blanket inversion would silently regress; hence a list
 * of named exceptions rather than a change to the rule.
 *
 * These four declare a `pad` on every bank, including the pages with no voice
 * behind them (spare grid seats opening Master/Reverb/Delay). Movy reads the
 * leading run of pad-declaring banks as the voices, so that layout says "every
 * bank is a voice" and collapses the whole module to one page. The bundled
 * copies are the same configs with the voice run leading and the page-only pads
 * dropped.
 *
 * DELETE AN ENTRY as soon as the module ships a config movy can use — the
 * bundled copy then goes back to being a dormant fallback. Leaving an id here
 * after that means overriding a module with a copy that is older than it. */
export const OVERRIDES_MODULE_FILE = new Set(['6w6', '8w8', '9w9', 'cw78']);

const CONFIGS: Record<string, ModuleConfig> = {
    '6w6':           k6w6Json         as unknown as ModuleConfig,
    '8w8':           k8w8Json         as unknown as ModuleConfig,
    '9w9':           k9w9Json         as unknown as ModuleConfig,
    cw78:            kcw78Json        as unknown as ModuleConfig,
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
    const bundled = CONFIGS[moduleId] ?? null;
    /* A module that describes itself wins by default; the bundled table is the
     * fallback for modules that ship nothing. OVERRIDES_MODULE_FILE is the list
     * of named exceptions. Checked BEFORE the file read, so an override costs
     * no host_read_file at all. */
    if (bundled && OVERRIDES_MODULE_FILE.has(moduleId)) return bundled;
    return tryFile(`${MOVY_MODULE_ROOT}/${componentCategory(componentKey)}/${moduleId}/movy_config.json`)
        ?? bundled
        ?? null;
}
