/* The view model movy's header, chrome and probe read for a param page. The
 * page body itself is Schwung's (movy's own page cells were retired
 * 2026-10-13 — tag `movy-pages-final`). */

/* Injected automation snapshot (built in app/tick from seqState + the lane
 * registry) so model/ stays free of seq/ imports. */
export interface AutomationView {
    assignedLanes: number;                 // bitmask, active track
    activeLanes:   number;                  // bitmask of lanes with locks
    held:          boolean;                 // a step is currently held
    poolFull:      boolean;                 // every lane used (limit toast)
    heldValues:    Map<number, number>;     // lane -> display value at held step
    liveValues:    Map<number, number>;     // lane -> value of a knob being turned live (cleared on release)
    laneForKey:    (key: string) => number; // param key -> lane (-1 none)
}

export interface ViewModel {
    moduleName:     string;
    /* When set, the header shows this verbatim instead of the "T<n> > module"
     * label — for non-track pages (e.g. the Set Params page). */
    headerOverride?: string;
    isEmpty:        boolean;
    drumPadCount:      number;
    drumCurrentPad:    number;
    drumCurrentPhysPad: number;
    /** What the MODULE calls the focused pad, or '' when it has not said. */
    drumPadName:       string;
    automationHeld:    boolean;   // a step is held → automation-edit view
    automationPoolFull: boolean;  // lane cap reached (limit toast)
    stepPagePresent:   boolean;   // a parameter-lock session is active → indicator prepends dotted segment
    stepPageSelected:  boolean;   // the step page is the selected page
}
