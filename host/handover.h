/* The boot door's way out (plan WP8). Opened from the boot picker, movy-host
 * IS the pid MoveLauncher supervises: an exit there reads as Move dying, so
 * every way out except a stop hands the device to Schwung by exec instead.
 * The Tools door never arms this — launch-standalone.sh brings Move back. */
#ifndef MH_HANDOVER_H
#define MH_HANDOVER_H

/* `standalone --boot` passes --boot on to movy-host. An argument, never an
 * environment variable: an exported one rides the exec into the next Schwung
 * session, and its next Tools launch would take the boot branches (dbx). */
void handover_arm(void);
int handover_armed(void);

/* schwung-entry.sh straight to Schwung (not back through the picker, which
 * could drop the user back into movy when movy is the default), then the
 * selector, then bare MoveOriginal. Each later entry is a fallback for a
 * MISSING earlier one: exec does not return on success. */
extern const char *const MH_HANDOVER_CHAIN[];

/* Async-signal-safe: closes every fd from 3 up (SPI is exclusive, and a
 * MoveOriginal that inherited it would find the device busy), then execs the
 * first of `chain` that runs. Returns only when none did. */
void handover_exec(const char *const *chain);

/* The normal way out: drains the log, then hands over unless not armed or
 * `rc` is MH_RC_TERM — a stop must never start Schwung. Returns `rc` when it
 * does not hand over. */
int handover_or_exit(int rc);
int handover_or_exit_via(int rc, const char *const *chain);   /* the tests' seam */

#endif
