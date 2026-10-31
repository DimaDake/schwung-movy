/* The glitch log: the recorder's lines (glitch.h) kept on the box for weeks,
 * so clicks heard over many sessions can be collected and ranked afterwards.
 *
 * debug.log cannot do it: it only fills while debug_log_on exists, stamps the
 * time of day without a date, and drowns the few lines that matter in ~4
 * perf lines a second. movy-host.log is replaced at every launch. This file is
 * always written, carries the date, and keeps only what a later ranking
 * needs: the glitch lines, each launch's banner (which build was running) and
 * the set loads and page opens that say what was on screen.
 *
 * Written by the log ring's writer thread, never the audio thread. Bounded:
 * past GLITCH_LOG_CAP bytes the file rotates to `<path>.1`, replacing the
 * previous one, so it never holds more than twice the cap. */
#ifndef MH_GLITCH_LOG_H
#define MH_GLITCH_LOG_H

#include <stdint.h>

#define GLITCH_LOG_CAP (8u << 20)

typedef struct {
    const char *path;
    uint32_t cap;
    int fd;          /* -1 until the first kept line opens it */
    uint64_t size;
} glitch_log_t;

/* Whether a log line belongs in the glitch log. */
int glitch_log_keeps(const char *text);

/* Appends one line stamped with `ms` (CLOCK_REALTIME) as a local date and
 * time, if glitch_log_keeps it. Best effort: a failed write is dropped. */
void glitch_log_write(glitch_log_t *g, int64_t ms, const char *text);

void glitch_log_close(glitch_log_t *g);

#endif
