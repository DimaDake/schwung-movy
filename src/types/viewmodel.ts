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
    renderStyle:     'arc' | 'hbar' | 'vbar' | 'preset';
    automated:       boolean;   // lane has ≥1 lock → show the dot
    automatable:     boolean;   // can be assigned a lane (numeric, non-global)
    assigned:        boolean;   // already bound to an automation lane
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
    bankName:       string;
    bankIndex:      number;
    bankCount:      number;
    rows:           (ParamVM | null)[][];
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
