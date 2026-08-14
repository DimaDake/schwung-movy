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
    renderStyle:     'arc' | 'hbar' | 'vbar' | 'preset' | 'xbox' | 'steps' | 'wave' | 'envstage' | 'cut';   // xbox = framed X (LFO target None); hbar doubles as a binary on/off bar; steps = framed number (octave/voice count); wave = waveform silhouette; envstage = a lone attack/decay ramp
    waveShape?:      number;    // glyph id for renderStyle 'wave' (see lfo-shapes.ts)
    waveOff?:        boolean;   // waveform toggle that is currently NOT sounding → drawn dotted
    envStage?:       'a' | 'd'; // which stage renderStyle 'envstage' draws (attack is the mirror)
    cutKind?:        'lowcut' | 'highcut';   // lone cut drawn as one corner (renderStyle 'cut')
    automated:       boolean;   // lane has ≥1 lock → show the dot
    automatable:     boolean;   // can be assigned a lane (numeric, non-global)
    assigned:        boolean;   // already bound to an automation lane
    modulated:       boolean;   // an LFO targets this param → show the ~ mark
    /* One-shot trigger badge. Absent for ordinary params. `trigger` is the badge
     * phase; `triggerCool` is the re-arm drain remaining (0..COOL_STEPS), which
     * is what makes the gesture-end debounce visible instead of mysterious. */
    trigger?:        'armed' | 'fired' | 'cooling';
    triggerCool?:    number;
    triggerBlink?:   boolean;   // fired: which half of the icon blink cycle
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
    name: string;       // qualifier label ("Filter"/"Amp"/""); not rendered, kept for tests
    startCol: number;   // graphic spans startCol..startCol+cellCount-1
    cellCount: number;  // 2..4 (partial AD/AR/ASR/ADS envelopes span fewer than 4)
    roles: string;      // present stages in order, e.g. "adsr" | "ad" | "ar" | "asr" | "ads"
}

export interface LfoVizVM {
    line:      0 | 1;
    startCol:  number;   // graphic spans startCol..startCol+1
    shape:     number;   // 0..10 (shapeSample id)
    phase:     number;   // 0..1
    mode:      number;   // 0 = unipolar, 1 = bipolar
    retrigger: number;   // 0/1
    deform?:   number;   // −1..1 waveform skew (module LFOs); absent = no skew
    cycles?:   number;   // cycles drawn across the span (rate partner: 1..2); default 2
    ampScale?: number;   // amplitude multiplier (depth partner: floor..1); default 1
}

export interface FilterVizVM {
    line:      0 | 1;
    startCol:  number;   // graphic spans startCol..startCol+1 (cutoff, resonance)
    cutoff:    number;   // 0..1 → curve feature x-position
    resonance: number;   // 0..1 → bump/dip magnitude
    mode:      'lp' | 'hp' | 'bp' | 'notch' | 'peak' | 'ap' | 'off';
    slope?:    0 | 1;    // 0 = 12 dB, 1 = 24 dB (steeper) — set only when known
}

/* An EQ band group drawn as one response curve across its 2-3 cells. `gains`
 * are signed −1..1 in the same order as `bands` (low→high). */
export interface EqVizVM {
    line:      0 | 1;
    startCol:  number;
    cellCount: number;
    bands:     import('../model/eq-viz.js').EqBand[];
    gains:     number[];
}

/* A low-cut + high-cut pair drawn as one band-pass across its two cells. */
export interface CutVizVM {
    line:      0 | 1;
    startCol:  number;
    cellCount: number;
    lowcut:    number;   // 0..1 corner position
    highcut:   number;
}

/* A sample waveform with a position marker, spanning its group's cells. */
export interface WavVizVM {
    line:      0 | 1;
    startCol:  number;
    cellCount: number;
    points:    number[];   // 0..1 peak per column; may be partial while loading
    /* Multiplier that takes the loudest column to full height. A sample mixed
     * well below 0 dB would otherwise draw as a thin line through the middle
     * and show none of its shape. */
    gain:      number;
    position:  number;     // 0..1 playback marker
    /* Loop bounds on the same sample, 0..1, drawn as brackets. */
    loopStart?: number;
    loopEnd?:   number;
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
    /* Per-option glyph ids when the param is a qualifying waveform enum; null
     * for every other list, which then renders exactly as it did before. */
    shapeIds: number[] | null;
}

export interface ViewModel {
    moduleName:     string;
    /* When set, the header shows this verbatim instead of the "T<n> > module"
     * label — for non-track pages (e.g. the Set Params page). */
    headerOverride?: string;
    bankName:       string;
    bankIndex:      number;
    bankCount:      number;
    /* One bank id per page: pages sharing an id are drawn flush in the page
     * indicator, so the bar shows the sections Shift+jog steps through. Omitted
     * by views whose pages are each their own bank (LFO, step/clip/set pages). */
    bankGroups?:    number[];
    rows:           (ParamVM | null)[][];
    /* When a knob line is an ADSR envelope, envelopeLines[line] is set and that
     * line's rows[line][0..3] hold the A,D,S,R ParamVMs in column order. */
    envelopeLines?:  (EnvelopeVM | null)[];
    /* LFO waveform groups on this page (Shape+Phase cells drawn as a wave). */
    lfoViz?:         LfoVizVM[];
    /* Filter-response groups on this page (cutoff+resonance drawn as a curve). */
    filterViz?:      FilterVizVM[];
    eqViz?:          EqVizVM[];
    cutViz?:         CutVizVM[];
    wavViz?:         WavVizVM[];
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
