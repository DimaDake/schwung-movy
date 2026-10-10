/* movy-host's log: every line from every thread goes through one in-process
 * ring, and ONE writer thread takes it to debug.log and stderr.
 *
 * Why not unified_log straight from each thread: it takes its mutex with a
 * TRYLOCK and silently drops the line when another thread holds it (so the
 * audio thread never blocks on an fflush). Under the shim the UI and the
 * engine are separate processes with a mutex each; movy-host puts them in
 * one, and a module load logging from the audio thread swallowed the UI's
 * `undo: LOAD MODULE` (reselect's undo-swap, red ~2 runs in 3, 2026-10-10).
 * With one writer nothing contends, and the audio thread never touches the
 * file at all.
 *
 * The same ring answers the test bus's LOG_SEQ / LOG_TAIL
 * (docs/standalone/testbus.md). Lines carry a 1-based sequence number in the
 * order they were pushed; the ring holds the last LOG_RING_CAP of them. */
#ifndef MH_LOG_RING_H
#define MH_LOG_RING_H

#include <stdint.h>

#define LOG_RING_CAP  4096u   /* power of two */
#define LOG_RING_TEXT 1008   /* the old direct path formatted 1024 */
#define LOG_RING_SRC  16

typedef struct {
    uint32_t seq;
    int64_t ms;                    /* CLOCK_REALTIME at push */
    char src[LOG_RING_SRC];
    char text[LOG_RING_TEXT];
} log_line_t;

/* Lock-free and wait-free for the caller: any thread, the audio one included.
 * Returns the line's sequence number. */
uint32_t log_ring_push(const char *src, const char *text);

/* The last sequence number handed out (0 = none yet). */
uint32_t log_ring_seq(void);

/* 1 = copied, 0 = not written yet (or still being written), -1 = lost (the
 * ring has wrapped past it). */
int log_ring_read(uint32_t seq, log_line_t *out);

/* The writer thread: drains the ring in sequence order into `sink`. stop()
 * drains what is left and joins, so nothing pushed before it is lost. */
typedef void (*log_sink_fn)(const log_line_t *line);
void log_ring_start(log_sink_fn sink);
void log_ring_stop(void);
/* Lines the writer found already overwritten (it fell LOG_RING_CAP behind). */
uint32_t log_ring_lost(void);

/* For the crash handler: write() the lines the writer has not reached yet, so
 * the last thing said before a crash is not lost with the process. */
void log_ring_flush_raw(int fd);

#endif
