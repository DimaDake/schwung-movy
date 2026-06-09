export interface KnobSlot {
    key:            string;
    short:          string;
    full:           string;
    type:           'float' | 'int' | 'enum' | 'file';
    render?:        'arc' | 'hbar' | 'vbar';
    options?:       string[];
    min?:           number;
    max?:           number;
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
}

export interface BankConfig {
    name: string;
    rows: (KnobSlot | null)[][];
}

export interface ModuleConfig {
    id:    string;
    name:  string;
    banks: BankConfig[];
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
    renderStyle:    'arc' | 'hbar' | 'vbar';
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
}
