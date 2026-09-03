import type { ModuleConfig } from '../types/param.js';
import { mlog } from '../log.js';
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
/* movy's own install dir. The override configs below are DATA FILES shipped
 * beside ui.js, not imports: esbuild inlines an imported .json into the single
 * bundle, and ui.js is re-evaluated on every tool open, so bundling these four
 * put 91 KB of JSON through the QuickJS parser every time movy was opened —
 * for configs that are only needed when one of those four modules is loaded.
 * As files they cost one host_read_file, and only for the module in the slot.
 * (The dodge-the-module-cache reason movy bundles its CODE does not apply: this
 * is a host file read, not an ES module import.) */
const MOVY_TOOL_ROOT   = `${MOVY_MODULE_ROOT}/tools/movy`;

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
    /* A module that describes itself wins by default; the bundled table is the
     * fallback for modules that ship nothing. OVERRIDES_MODULE_FILE is the list
     * of named exceptions, whose replacement configs ship beside ui.js. */
    if (OVERRIDES_MODULE_FILE.has(moduleId)) {
        const override = tryFile(`${MOVY_TOOL_ROOT}/configs/${moduleId}.json`);
        if (override) return override;
        /* Deployed without its configs. Falling through silently would hand the
         * module back the layout the override exists to replace — a kit that
         * quietly collapses to one page — so say which file is missing. */
        mlog('loadModuleConfig: no override config for ' + moduleId
             + ', falling back to the module\'s own');
    }
    const bundled = CONFIGS[moduleId] ?? null;
    return tryFile(`${MOVY_MODULE_ROOT}/${componentCategory(componentKey)}/${moduleId}/movy_config.json`)
        ?? bundled
        ?? null;
}
