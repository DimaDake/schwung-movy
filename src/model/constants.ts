export const NAME_POLL_TICKS        = 344;  /* ~1 s at device tick rate */
export const LONG_PRESS_TICKS       = 172;  /* ~0.5 s */
export const REFRESH_SUPPRESS_TICKS = 100;  /* ticks of knob-idle before refresh resumes (~200 ms) */
export const KNOBS_PER_PAGE         = 8;
export const KNOBS_PER_ROW          = 4;
export const ENUM_DELTA_DIV         = 4;    /* physical turns needed per 1 enum step */
export const ARC_DELTA_SCALE        = 0.5;  /* sensitivity multiplier for continuous arc knobs */
/* A float/int knob's per-detent step is normalized to this fraction of its
 * range, so every knob has a consistent ~100-detent sweep regardless of units
 * (matches a 0..1 param with step 0.01 = cutoff's feel). Fixes both crawling
 * wide-range knobs (reso 0.5..20) and hair-trigger narrow ones. Ints keep their
 * natural step as a floor so discrete values still move; enums are exempt. */
export const MIN_STEP_RANGE_FRAC    = 0.01;
