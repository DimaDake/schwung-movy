#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "log_ring.h"

#define MASK (LOG_RING_CAP - 1)

/* Each slot is a seqlock: `commit` is 0 while a producer writes it and the
 * line's seq once it is whole, so a reader that copied a slot mid-rewrite
 * sees the mismatch and treats the line as lost rather than torn. */
typedef struct { uint32_t commit; log_line_t line; } slot_t;

static slot_t g_ring[LOG_RING_CAP];
static uint32_t g_head;   /* seqs handed out */

static pthread_t g_writer;
static int g_writer_on, g_stop;
static log_sink_fn g_sink;
static uint32_t g_next = 1, g_lost;

uint32_t log_ring_push(const char *src, const char *text) {
    uint32_t seq = __atomic_add_fetch(&g_head, 1, __ATOMIC_ACQ_REL);
    slot_t *s = &g_ring[(seq - 1) & MASK];
    __atomic_store_n(&s->commit, 0, __ATOMIC_RELAXED);
    __atomic_thread_fence(__ATOMIC_RELEASE);
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    s->line.seq = seq;
    s->line.ms = (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
    snprintf(s->line.src, sizeof s->line.src, "%s", src ? src : "?");
    snprintf(s->line.text, sizeof s->line.text, "%s", text ? text : "");
    __atomic_store_n(&s->commit, seq, __ATOMIC_RELEASE);
    return seq;
}

uint32_t log_ring_seq(void) { return __atomic_load_n(&g_head, __ATOMIC_ACQUIRE); }

int log_ring_read(uint32_t seq, log_line_t *out) {
    uint32_t head = log_ring_seq();
    if (seq == 0 || seq > head) return 0;
    if (head - seq >= LOG_RING_CAP) return -1;
    slot_t *s = &g_ring[(seq - 1) & MASK];
    uint32_t v = __atomic_load_n(&s->commit, __ATOMIC_ACQUIRE);
    if (v != seq) return (int32_t)(v - seq) > 0 ? -1 : 0;
    memcpy(out, &s->line, sizeof *out);
    __atomic_thread_fence(__ATOMIC_ACQUIRE);
    return __atomic_load_n(&s->commit, __ATOMIC_RELAXED) == seq ? 1 : -1;
}

uint32_t log_ring_lost(void) { return __atomic_load_n(&g_lost, __ATOMIC_RELAXED); }

/* One pass: everything committed, in order. Stops at a line still being
 * written so the order is never broken; the next pass picks it up. */
static int drain(void) {
    int n = 0;
    log_line_t l;
    while (g_next <= log_ring_seq()) {
        int r = log_ring_read(g_next, &l);
        if (r == 0) break;
        if (r < 0) { __atomic_add_fetch(&g_lost, 1, __ATOMIC_RELAXED); g_next++; continue; }
        g_sink(&l);
        g_next++;
        n++;
    }
    return n;
}

/* Polled, not signalled: a wake-up would cost the audio thread a syscall. */
static void *writer_main(void *arg) {
    (void)arg;
#ifdef __linux__
    pthread_setname_np(pthread_self(), "movy-log");
#endif
    while (!__atomic_load_n(&g_stop, __ATOMIC_ACQUIRE)) {
        if (!drain()) {
            struct timespec ts = { 0, 2000000L };
            nanosleep(&ts, NULL);
        }
    }
    /* A producer mid-push at stop gets a moment to finish its line. */
    for (int i = 0; i < 50 && g_next <= log_ring_seq(); i++) {
        if (!drain()) { struct timespec ts = { 0, 1000000L }; nanosleep(&ts, NULL); }
    }
    return NULL;
}

void log_ring_start(log_sink_fn sink) {
    if (g_writer_on) return;
    g_sink = sink;
    __atomic_store_n(&g_stop, 0, __ATOMIC_RELEASE);
    g_writer_on = pthread_create(&g_writer, NULL, writer_main, NULL) == 0;
}

void log_ring_stop(void) {
    if (!g_writer_on) return;
    __atomic_store_n(&g_stop, 1, __ATOMIC_RELEASE);
    pthread_join(g_writer, NULL);
    g_writer_on = 0;
}

/* write() only: called from a signal handler. Order and completeness are best
 * effort — the process is going down. */
void log_ring_flush_raw(int fd) {
    uint32_t head = log_ring_seq();
    for (uint32_t s = g_next; s <= head; s++) {
        slot_t *sl = &g_ring[(s - 1) & MASK];
        if (__atomic_load_n(&sl->commit, __ATOMIC_ACQUIRE) != s) continue;
        const char *parts[] = { "[", sl->line.src, "] ", sl->line.text, "\n" };
        for (unsigned i = 0; i < 5; i++)
            if (write(fd, parts[i], strlen(parts[i])) < 0) return;
    }
}
