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
}
