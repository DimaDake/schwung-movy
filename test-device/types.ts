export type Check = {
    id: string;
    label: string;
    pass: boolean;
    expected?: string;
    actual?: string;
    frame?: number;
};

/* Why an attempt ended badly. `infra` is the link to the device; `assert` is
 * everything the device itself said or failed to say — see errors.ts. */
export type FailKind = 'infra' | 'assert';

export type Attempt = {
    n: number;
    checks: Check[];
    error?: string;
    kind?: FailKind;          // absent when the attempt passed
    seconds: number;
    notes: Record<string, unknown>;
};

/* `flaky` is a PASS that had to be repeated. It does not fail the run, but it
 * is never silent: it prints, it lands in the report, and it accumulates in the
 * flake log — so "the device tests are flaky" becomes a count of which check,
 * how often, rather than a reason to stop reading them. */
export type Status = 'pass' | 'flaky' | 'fail';

export type ScenarioResult = {
    name: string;
    status: Status;
    /* The final attempt's, which is what the scenario is graded on. Earlier
     * attempts keep their own in `attempts`. */
    checks: Check[];
    error?: string;
    attempts: Attempt[];
    seconds: number;          // total across attempts
    notes: Record<string, unknown>;
};
