export interface KnobSlot {
    key:            string;
    short:          string;
    full:           string;
    type:           'float' | 'int' | 'enum' | 'file';
    render?:        'arc' | 'hbar' | 'vbar' | 'preset';
    options?:       string[];
    min?:           number;
    max?:           number;
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
    fileRequireContains?: string;
}

export interface BankConfig {
    name: string;
    rows: (KnobSlot | null)[][];
    padSpecific?: boolean;
}

export interface ModuleConfig {
    id:    string;
    name:  string;
    banks: BankConfig[];
    drum?: DrumConfig;
}

export interface DrumConfig {
    padCount:         number;
    padNoteStart:     number;
    rawMidi:          boolean;
    currentPadParam?: string;
    shiftSelectMidi?: boolean;
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
    renderStyle:    'arc' | 'hbar' | 'vbar' | 'preset';
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
    fileRequireContains?: string;
}
