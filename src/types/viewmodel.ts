export interface ParamVM {
    shortName:       string;
    fullName:        string;
    type:            string;
    normalizedValue: number;
    displayValue:    string;
    touched:         boolean;
    isLongEnum:      boolean;
    options:         string[] | null;
    enumIndex:       number;
    renderStyle:     'arc' | 'hbar' | 'vbar' | 'preset' | 'xbox';   // xbox = framed X (LFO target None); hbar doubles as a binary on/off bar
    automated:       boolean;   // lane has ≥1 lock → show the dot
    automatable:     boolean;   // can be assigned a lane (numeric, non-global)
    assigned:        boolean;   // already bound to an automation lane
    modulated:       boolean;   // an LFO targets this param → show the ~ mark
}

/* Injected automation snapshot (built in app/tick from seqState + the lane
 * registry) so model/ stays free of seq/ imports. */
export interface AutomationView {
    assignedLanes: number;                 // bitmask, active track
    activeLanes:   number;                  // bitmask of lanes with locks
    held:          boolean;                 // a step is currently held
    poolFull:      boolean;                 // all 8 lanes used (limit toast)
    heldValues:    Map<number, number>;     // lane -> display value at held step
    liveValues:    Map<number, number>;     // lane -> value of a knob being turned live (cleared on release)
    laneForKey:    (key: string) => number; // param key -> lane (-1 none)
}

export interface EnvelopeVM {
    name: string;   // qualifier label ("Filter"/"Amp"/""); not rendered, kept for tests/future
}

export interface LfoVizVM {
    line:      0 | 1;
    startCol:  number;   // graphic spans startCol..startCol+1
    shape:     number;   // 0..5 (LFO_SHAPES order)
    phase:     number;   // 0..1
    mode:      number;   // 0 = unipolar, 1 = bipolar
    retrigger: number;   // 0/1
}

export interface ToastState {
    fullName:   string;
    value:      string;
    browseHint: boolean;
}

export interface OverlayState {
    slot:     number;
    options:  string[];
    selected: number;
}

export interface ViewModel {
    moduleName:     string;
    /* When set, the header shows this verbatim instead of the "T<n> > module"
     * label — for non-track pages (e.g. the Set Params page). */
    headerOverride?: string;
    bankName:       string;
    bankIndex:      number;
    bankCount:      number;
    rows:           (ParamVM | null)[][];
    /* When a knob line is an ADSR envelope, envelopeLines[line] is set and that
     * line's rows[line][0..3] hold the A,D,S,R ParamVMs in column order. */
    envelopeLines?:  (EnvelopeVM | null)[];
    /* LFO waveform groups on this page (Shape+Phase cells drawn as a wave). */
    lfoViz?:         LfoVizVM[];
    touchedSlot:    number | null;
    toast:          ToastState | null;
    overlay:        OverlayState | null;
    isEmpty:        boolean;
    drumPadCount:      number;
    drumCurrentPad:    number;
    drumCurrentPhysPad: number;
    isPadSpecific:     boolean;
    automationHeld:    boolean;   // a step is held → automation-edit view
    automationPoolFull: boolean;  // 8-lane cap reached (limit toast)
    stepPagePresent:   boolean;   // a parameter-lock session is active → indicator prepends dotted segment
    stepPageSelected:  boolean;   // the step page is the selected page (render step params)
}
