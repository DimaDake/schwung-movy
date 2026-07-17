export interface KnobSlot {
    key:            string;
    short:          string;
    full:           string;
    type:           'float' | 'int' | 'enum' | 'file';
    render?:        'arc' | 'hbar' | 'vbar' | 'preset';
    env?:           'a' | 'd' | 's' | 'r';
    lfo?:           'shape' | 'phase' | 'mode' | 'retrig' | 'rate' | 'depth' | 'deform';
    filter?:        'cutoff' | 'resonance' | 'mode' | 'slope';
    options?:       string[];
    min?:           number;
    max?:           number;
    /* For a `render: 'preset'` slot: the chain_params keys movy polls for the
     * preset count and the live preset name. Both default to the module's
     * ui_hierarchy root `count_param`/`name_param` when omitted, so a config
     * usually only needs `render: 'preset'`. If no count is resolvable the slot
     * degrades to a plain indexed knob. */
    presetCountKey?: string;
    presetNameKey?:  string;
    fileRoot?:      string;
    fileFilter?:    string[];
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
}

export interface DrumConfig {
    padCount:         number;
    padNoteStart:     number;
    rawMidi:          boolean;
    currentPadParam?: string;
    shiftSelectMidi?: boolean;
    /* How an alias pad param ("pad_vol") maps to its concrete per-pad key
     * ("p03_vol"). Lets movy address the focused pad directly, with no key-shape
     * literal in code. */
    padScoping?: {
        aliasPrefix:         string;   // "pad_"
        concreteKeyTemplate: string;   // "p{pad}_{suffix}"
        padDigits:           number;   // 2
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
    renderStyle:    'arc' | 'hbar' | 'vbar' | 'preset' | 'xbox';
    env?:           'a' | 'd' | 's' | 'r';
    lfo?:           'shape' | 'phase' | 'mode' | 'retrig' | 'rate' | 'depth' | 'deform';
    filter?:        'cutoff' | 'resonance' | 'mode' | 'slope';
    automatable:    boolean;
    /* Set when type/range were guessed (no chain_params or hierarchy metadata).
     * The first successful value read infers the real type/range, then clears
     * this. See model/meta-infer.ts. */
    metaGuessed?:   boolean;
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
    fileRequireContains?: string;
}
