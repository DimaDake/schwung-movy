export interface KnobSlot {
    key:    string;
    short:  string;
    full:   string;
    type:   'float' | 'int' | 'enum';
    render?: 'arc' | 'hbar' | 'vbar';
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
    key:        string;
    label:      string;
    shortLabel: string | null;
    type:       'float' | 'int' | 'enum';
    min:        number;
    max:        number;
    step:       number;
    options:    string[] | null;
    nameKey?:   string;
    renderStyle: 'arc' | 'hbar' | 'vbar';
}
