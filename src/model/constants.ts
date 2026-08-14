/* Probes of asynchronous module metadata (preset lists, enum option sets that
 * arrive after load) before movy stops asking. One probe per name poll. */
export const META_RETRY_LIMIT       = 8;
export const NAME_POLL_TICKS        = 344;  /* ~1 s at device tick rate */
export const LONG_PRESS_TICKS       = 172;  /* ~0.5 s */
/* How often a visible_if controller is re-read. movy's tick period IS its MIDI
 * sampling interval, so an IPC read on EVERY tick is paid for in input latency
 * — but the page must still follow a toggle quickly enough to feel immediate.
 * ~16 ticks is well under the ~150 ms a user reads as instant, and cuts the
 * cost to well under a tenth of a call per tick. */
export const VISIBILITY_POLL_TICKS  = 16;
export const REFRESH_SUPPRESS_TICKS = 100;  /* ticks of knob-idle before refresh resumes (~200 ms) */
/* Hold-without-moving before a "you can also do X here" gesture fires: knob
 * hold → LFO assign mode, jog touch → the bottom CLICK JOG hint. One constant
 * so both feel like the same gesture. */
export const HOLD_MS                = 1000;
/* One-shot trigger knobs. FLASH is how long the fired badge stays inverted.
 * REARM is a gesture-end debounce, not a delay: it restarts on every turn, so
 * the latch releases only once the hand actually stops (one sweep = one fire).
 * The badge renders REARM as a drain, so this value is user-visible — changing
 * it invalidates the trigger screenshot baselines. */
export const TRIGGER_FLASH_MS       = 200;
/* Blink half-period while fired: the icon alternates on/off so the confirmation
 * reads as a blink rather than a single flash. 200/50 = four alternations. */
export const TRIGGER_BLINK_MS       = 50;
export const TRIGGER_REARM_MS       = 700;
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
