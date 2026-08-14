export interface KnobSlot {
    key:            string;
    short:          string;
    full:           string;
    type:           'float' | 'int' | 'enum' | 'file';
    render?:        'arc' | 'hbar' | 'vbar' | 'preset';
    env?:           'a' | 'd' | 's' | 'r';
    lfo?:           'shape' | 'phase' | 'mode' | 'retrig' | 'rate' | 'depth' | 'deform';
    filter?:        'cutoff' | 'resonance' | 'mode' | 'slope';
    /* Override movy's automatable heuristic: force a param on (an enum the host
     * can still automate as an index) or off (a per-voice key the host can't
     * resolve, so no misleading automation dot). */
    automatable?:   boolean;
    /* One-shot actions stay visually idle: clockwise fires once per gesture,
     * counter-clockwise sends idle and re-arms the gesture. */
    behavior?:      'trigger';
    /**
     * This param REWRITES other params when it changes, so its inverse is
     * lossy: writing the old value back makes the DSP re-apply that selection's
     * defaults, discarding anything the user tweaked afterwards. Undo therefore
     * snapshots the whole module (schwung's `<component>:state`) before the
     * change and restores that instead.
     *
     * `render: "preset"` implies this and needs no flag. Set it explicitly for
     * the params that behave like a preset without looking like one — a bank or
     * ROM selector (osirus `rom_index`/`bank_index`), or a plugin selector whose
     * choice redefines what the other knobs mean (clap/airwindows
     * `plugin_index`).
     *
     * Trade-offs, which are why this is opt-in rather than the default:
     *   - One extra BLOCKING chain read per gesture (~3-5 ms on device against
     *     a 2-reads-per-tick budget — see browser-test/perf.mjs). Fine next to a
     *     preset load; not fine on an ordinary knob.
     *   - The undo entry grows from ~50 bytes to the size of the state blob,
     *     hundreds of bytes to several KB, and the stack holds 64 of them.
     *   - Undo then restores the WHOLE module, so it also reverts params the
     *     user never touched — including ones automation or an LFO is driving.
     *     Only mark a param where that is the lesser evil, i.e. where the param
     *     really does rewrite the others.
     */
    capturesModuleState?: boolean;

    /* Wide integer spaces (sample indexes, random seeds, etc.) retain
     * single-step precision on a slow turn and accelerate on a fast sweep. */
    knobAcceleration?: 'wide';
    options?:       string[];
    min?:           number;
    max?:           number;
    /* Rarely needed: applyKnobDelta normalizes float sensitivity from the range,
     * so a config `step` only acts as an int floor / max<=min fallback. */
    step?:          number;
    /* For a `render: 'preset'` slot: the chain_params keys movy polls for the
     * preset count and the live preset name. Both default to the module's
     * ui_hierarchy root `count_param`/`name_param` when omitted, so a config
     * usually only needs `render: 'preset'`. If no count is resolvable the slot
     * degrades to a plain indexed knob. */
    presetCountKey?: string;
    presetNameKey?:  string;
    fileRoot?:      string;
    fileFilter?:    string[];
    /* wav_position only: the key of the file param whose sample this marker
     * indexes. Schwung declares the link explicitly, so the waveform never has
     * to guess which of a page's file params it belongs to. */
    /* Render hint that does NOT change the data type — schwung's `ui_type`.
     * A wav_position is a float; treating it as its own type made the write
     * path fall through to String(Math.round(v)) and store 0 for every value
     * below 0.5. */
    uiType?:        string;
    filepathParam?: string;
    /* Markers sharing a view group draw on one waveform (schwung's view_group). */
    viewGroup?:     string;
    fileStartPath?: string;
    fileRequireContains?: string;
}

export interface BankConfig {
    name: string;
    rows: (KnobSlot | null)[][];
    padSpecific?: boolean;
    /* Params in this bank are non-automatable globals (not reachable as a chain
     * target:param). Replaces the old `g_` key-prefix heuristic. */
    global?: boolean;
}

export interface ModuleConfig {
    id:    string;
    name:  string;
    banks: BankConfig[];
    drum?: DrumConfig;
    /* Params to set once when the module loads (e.g. disable a DSP auto-behavior
     * movy wants to own). Applied as componentKey-prefixed sets. */
    setOnLoad?: Record<string, string>;
    /* Commit enum values by INDEX even when the DSP reports them by NAME on read.
     * For modules whose set_param parses an integer index but whose get_param
     * returns the option name (e.g. Forge) — without this movy would echo the
     * name back and the DSP's atoi() would collapse every choice to index 0. */
    enumSetIndex?: boolean;
}

export interface DrumConfig {
    padCount:         number;
    padNoteStart:     number;
    rawMidi:          boolean;
    currentPadParam?: string;
    shiftSelectMidi?: boolean;
    /* Only pads 1..N are host-automatable (the chain caps declared params at 256,
     * so a padScoped module can only declare concrete keys for some voices —
     * Forge: Kit A pv1-8). A param on a pad past this is not offered for
     * automation, so no dead dot appears. Omit = all pads automatable. */
    automatablePads?: number;
    /* How an alias pad param ("pad_vol") maps to its concrete per-pad key
     * ("p03_vol"). Lets movy address the focused pad directly, with no key-shape
     * literal in code. */
    padScoping?: {
        aliasPrefix:         string;   // "pad_"
        concreteKeyTemplate: string;   // "p{pad}_{suffix}"
        padDigits:           number;   // 2
        /* Per-suffix template overrides for params whose concrete keys follow a
         * different shape than the module's main template (Forge: sends/pan are
         * v{pad}_fx1, not pv{pad}_fx1 — only the v-form is host-automatable).
         * `maxPad` bounds the override to pads whose v-form keys the DSP accepts
         * (Forge: Kit A, 1-8); beyond it the main template applies, keeping the
         * param editable (not automatable) on the remaining pads. */
        suffixOverrides?: Record<string, { template: string; maxPad?: number }>;
    };
}

export interface KnobParam {
    key:            string;
    label:          string;
    shortLabel:     string | null;
    type:           'float' | 'int' | 'enum' | 'file';
    min:            number;
    max:            number;
    step:           number;
    options:        string[] | null;
    nameKey?:       string;
    renderStyle:    'arc' | 'hbar' | 'vbar' | 'preset' | 'xbox' | 'steps';
    /** Step cell whose value reads as an offset: show a leading + above zero. */
    signed?:        boolean;
    env?:           'a' | 'd' | 's' | 'r';
    lfo?:           'shape' | 'phase' | 'mode' | 'retrig' | 'rate' | 'depth' | 'deform';
    filter?:        'cutoff' | 'resonance' | 'mode' | 'slope';
    automatable:    boolean;
    behavior?:      'trigger';
    /** See KnobSlot.capturesModuleState — resolved from the config, or implied
     *  by `renderStyle === 'preset'`. */
    capturesModuleState?: boolean;
    knobAcceleration?: 'wide';
    /* Cached enum classification (shape / division / filter mode / slope). See
     * model/enum-class.ts: computing it reads the whole option list several
     * times, and the page layout that needs it is rebuilt every frame. */
    enumClass?:     import('../model/enum-class.js').EnumClass;
    /* Set when type/range were guessed (no chain_params or hierarchy metadata).
     * The first successful value read infers the real type/range, then clears
     * this. See model/meta-infer.ts. */
    metaGuessed?:   boolean;
    fileRoot?:      string;
    fileFilter?:    string[];
    /* wav_position only: the key of the file param whose sample this marker
     * indexes. Schwung declares the link explicitly, so the waveform never has
     * to guess which of a page's file params it belongs to. */
    /* Render hint that does NOT change the data type — schwung's `ui_type`.
     * A wav_position is a float; treating it as its own type made the write
     * path fall through to String(Math.round(v)) and store 0 for every value
     * below 0.5. */
    uiType?:        string;
    filepathParam?: string;
    /* Markers sharing a view group draw on one waveform (schwung's view_group). */
    viewGroup?:     string;
    fileStartPath?: string;
    fileRequireContains?: string;
}
