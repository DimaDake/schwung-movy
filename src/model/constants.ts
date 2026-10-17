/* How long a module takes to land, in ticks — the window in which its own
 * answers are still on their way, and so the span every "has it arrived yet"
 * question is measured against. ~1 s at the device tick rate. Named once
 * because the name probe below and the delegated page's contract retry
 * (renderer/schwung-page-contract.ts) ask that one question. */
export const MODULE_LOAD_TICKS      = 344;  /* ~1 s at device tick rate */
/* Probes of asynchronous module metadata (preset lists, enum option sets that
 * arrive after load) before movy stops asking. One probe per name poll. */
export const META_RETRY_LIMIT       = 8;
export const NAME_POLL_TICKS        = MODULE_LOAD_TICKS;
/* A hierarchy read that lands EMPTY right after a load is not a verdict — the
 * same race renderer/schwung-page-contract.ts's own RETRY_TICKS/RETRY_LIMIT
 * exist for (SP-15), measured there against the identical "module still
 * publishing" window. Restated rather than imported (model/ must not depend
 * on renderer/, R12), so a re-tune of one is not automatically the other's —
 * they are the same NUMBER because it is the same window, not because one
 * file feeds the other. Meta-retry's OWN NAME_POLL_TICKS cadence (~1 s, 8
 * tries) is left alone for preset/enum settling — nobody is watching an
 * osirus ROM scan — but a master FX load is watched the instant it happens,
 * and waiting for that slow cadence is the "parameters appear after a
 * delay" a user reported (docs/schwung-page-migration.md, mfx-slot-params). */
export const HIERARCHY_RETRY_TICKS  = 12;
export const HIERARCHY_RETRY_LIMIT  = 60;
/* Hold-without-moving before a "you can also do X here" gesture fires: knob
 * hold → LFO assign mode, jog touch → the bottom CLICK JOG hint. One constant
 * so both feel like the same gesture. */
export const HOLD_MS                = 1000;
export const KNOBS_PER_PAGE         = 8;
export const ENUM_DELTA_DIV         = 4;    /* physical turns needed per 1 enum step */
export const ARC_DELTA_SCALE        = 0.5;  /* sensitivity multiplier for continuous arc knobs */
/* A float/int knob's per-detent step is normalized to this fraction of its
 * range, so every knob has a consistent ~100-detent sweep regardless of units
 * (matches a 0..1 param with step 0.01 = cutoff's feel). Fixes both crawling
 * wide-range knobs (reso 0.5..20) and hair-trigger narrow ones. Ints keep their
 * natural step as a floor so discrete values still move; enums are exempt. */
export const MIN_STEP_RANGE_FRAC    = 0.01;
/* One CC unit's share of a continuous knob's travel — the two constants above,
 * multiplied. Movy's own mixer steps by this so a fader, a pan and a send
 * travel exactly as far per turn as the module knobs either side of them
 * (mixer/db-ladder.ts). */
export const CONTINUOUS_TICK_FRAC   = MIN_STEP_RANGE_FRAC * ARC_DELTA_SCALE;
