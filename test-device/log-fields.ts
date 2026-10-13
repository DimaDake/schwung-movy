/* One reader for a field out of a movy log line, and the thresholds smoke
 * grades by — arithmetic on strings and numbers, nothing that touches a Bus, a
 * Device or an ssh. `smoke` is the only caller.
 */

/* A numeric field out of one line. The leading separator keeps `t=` out of
 * `set=`, `k=` out of `chainIndex=`, and so on. NaN for a field that is not
 * there — never 0, because a line that never arrived must not read as a
 * plausible value. */
export const at = (line: string, name: string): number => {
    const m = line.match(new RegExp('(?:^| )' + name + '=(-?[0-9]+)'));
    return m ? Number(m[1]) : NaN;
};

export const lastOf = (ls: string[]): string => (ls.length ? ls[ls.length - 1] : '');

/* TICK_RATE_MIN only catches catastrophic starvation — the schwung host caps the
 * loop far below its ~500 Hz target, and a heavy co-running synth drags the
 * achievable rate to ~80 Hz (verified identical on a pre-feature build). */
export const TICK_RATE_MIN = 60;
