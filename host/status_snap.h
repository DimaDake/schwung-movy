/* The engine's `status`, published by the audio thread after each render and
 * read by the UI without a queue or a wait (plan WP10).
 *
 * A seqlock: one writer (the audio thread), one reader (the UI). The reader
 * copies and retries if a publish overlapped its copy, so it never sees half
 * of one snapshot and half of the next, and the writer never waits.
 *
 * `served` is the param queue's served count when this status was taken
 * (param_queue.h): every request up to it was in the engine before that
 * render, which is what lets the UI tell a fresh answer from a stale one. */
#ifndef MH_STATUS_SNAP_H
#define MH_STATUS_SNAP_H

#include <stdint.h>

#define STATUS_SNAP_CAP 16384

/* Audio thread. 0 when `len` does not fit: refused, never truncated (a cut
 * status would parse as a different one), and the last good one stands. */
int snap_publish(const char *text, int len, uint64_t served);
/* Publishes so far; 0 = none yet. Cheap: the UI asks this every tick. */
uint32_t snap_seq(void);
/* Copy the latest into out (NUL-terminated). Length, or -1 when none. */
int snap_read(char *out, int cap, uint32_t *seq, uint64_t *served);

#endif
