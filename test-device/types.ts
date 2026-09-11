export type Check = {
    id: string;
    label: string;
    pass: boolean;
    expected?: string;
    actual?: string;
    frame?: number;
};

export type ScenarioResult = {
    name: string;
    checks: Check[];
    error?: string;
    seconds: number;
    notes: Record<string, unknown>;
};
