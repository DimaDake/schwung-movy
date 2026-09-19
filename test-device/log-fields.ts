/* One reader for a field out of a movy log line, and the arithmetic and
 * thresholds the refresh window is graded by.
 *
 * EXTRACTED FROM scenarios/smoke.ts, not written as a new thing. That scenario
 * had to arm its own renderer (see the note at its `refresh-blocking` check) and
 * sits at 583 lines against the ~600 ceiling, so the addition had to be paid for
 * by moving something out rather than by a longer file. What moved is the part
 * of smoke that is arithmetic on strings and numbers: nothing here touches a
 * Bus, a Device, an ssh, or a scenario, which is what makes it a module rather
 * than a fragment of one. Everything else in smoke stayed where it is.
 *
 * `smoke` is still the only caller. If a second scenario wants these, they are
 * already in the shape to be shared; they are here rather than in a generic
 * `util.ts` because each one is defined by a property of movy's log rather than
 * by being generally useful.
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

/* Lower median: the middle sample of an odd count, the lower of the middle two
 * of an even count. Deliberately NOT an average — an average is moved by a
 * single 458 ms outlier, which is the exact quantity the refresh check must
 * ignore. */
export const median = (xs: number[]): number => {
    const v = [...xs].sort((a, b) => a - b);
    return v[Math.floor((v.length - 1) / 2)];
};

/* The refresh samples in a window that MEASURED something, in ms — the only
 * ones whose number is a refresh cost. One reader, because the window's close
 * condition and the check's assertion have to be the same rule. */
export const refreshSamples = (w: string[]): number[] =>
    w.filter((l) => l.includes('perf_refresh_ms='))
     .filter((l) => at(l, 'params') > 0)
     .map((l) => at(l, 'perf_refresh_ms'));

/* Thresholds, unchanged from the bash. TICK_RATE_MIN only catches catastrophic
 * starvation — the overtake loop targets ~500 Hz but the schwung host caps it
 * far lower, and a heavy co-running synth drags the achievable rate to ~80 Hz
 * (verified identical on a pre-feature build). REFRESH_MS_MAX is the real
 * per-tick blocking detector: one shadow_get_param measures ~3 ms, so 10 ms
 * allows for shim jitter and any single sample over it fails. */
export const TICK_RATE_MIN  = 60;
export const REFRESH_MS_MAX = 10;

/* How many MEASURING refresh samples the window must hold before its median is
 * allowed to mean anything. A sample carries `params=N`; N=0 means the refresh
 * had no populated param to read, so its ms is not a refresh cost and counting
 * it is how this check used to pass over a metric that measured nothing. The
 * window is CLOSED on this count — the same helper both waits for it and
 * asserts on it, so the two can never disagree about what counts.
 *
 * CLOSING AT EXACTLY THIS COUNT IS DELIBERATE, and it makes the graded number
 * the most sensitive it can be rather than the least: a median of 3 is moved by
 * 2 of its 3 samples, where a median of 5 needs 3. So the window stops as soon
 * as the check can mean anything, and every sample it does grade counts. The
 * cost is noise, and the 10 ms budget is what absorbs it — steady state is 4-5
 * ms (measured 2026-09-13), so a single slow sample cannot carry the median
 * over on its own. */
export const REFRESH_MIN_SAMPLES = 3;

/* What the refresh window's wait may spend before it gives up. It is NOT the
 * window's size: the window is closed by a COUNT of measuring samples
 * (REFRESH_MIN_SAMPLES above), and this is only how long reaching that count is
 * allowed to take.
 *
 * The sample cadence is set by the TICK rate, not by the clock: movy emits
 * perf_refresh_ms every NAME_POLL_TICKS (344) ticks, and the tick rate swings
 * 63-205 Hz with device load — so one sample is 2.3 s at 152 Hz and 5.5 s at
 * 63 Hz. A fixed frame budget is a bet on the device's speed, and it is a bet
 * this box currently wins: restoring the old 2400-frame budget under the
 * corrected window did NOT go red (measured 2026-09-19), because 2400 frames
 * ≈ 7 s still spans three samples at 151 Hz. At the 63 Hz floor the same budget
 * buys one. Sizing on the slow case costs nothing, since the count closes the
 * window the instant the third sample lands — 344 ticks at 63 Hz is 5.5 s, three
 * of them (one for the phase offset, two for the gaps) is ~16 s, and this is
 * 6000 frames ≈ 17 s at the shim's ~2.9 ms SPI period.
 *
 * It is a LET-THE-DEVICE-WORK budget, not a sleep: the wait returns the moment
 * the third measuring sample exists, so a fast device pays seconds and only a
 * genuine failure pays all of it.
 *
 * AND IT IS STILL A FRAME BUDGET, so the rate-dependence has not gone away — it
 * has moved from the window's SIZE to its TIMEOUT. On a healthy but loaded
 * device (63-90 Hz) three samples can legitimately take most of this, and the
 * tier will print `! wait near budget` for this check (`NEAR_BUDGET = 0.7` in
 * runner.ts). That is the tier's own "next month's flake" signal and it is
 * expected here, not a fault to go and widen: the fix would be waiting on a
 * sample COUNT without any ceiling, which cannot terminate on a device whose
 * refresh genuinely stopped — the case this check exists to red. */
export const PERF_WINDOW_MAX = 6000;
