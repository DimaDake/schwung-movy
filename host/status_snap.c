#include <string.h>

#include "status_snap.h"

/* g_lock is odd while a publish is in progress. Everything a reader copies,
 * the count included, changes only inside it, so one even g_lock value names
 * exactly one snapshot. */
static uint32_t g_lock;
static uint32_t g_count;
static int g_len;
static uint64_t g_served;
static char g_text[STATUS_SNAP_CAP];

int snap_publish(const char *text, int len, uint64_t served) {
    if (len < 0 || len >= STATUS_SNAP_CAP) return 0;
    __atomic_add_fetch(&g_lock, 1, __ATOMIC_ACQ_REL);
    __atomic_thread_fence(__ATOMIC_RELEASE);
    memcpy(g_text, text, (size_t)len);
    g_text[len] = '\0';
    g_len = len;
    g_served = served;
    __atomic_store_n(&g_count, g_count + 1, __ATOMIC_RELAXED);
    __atomic_thread_fence(__ATOMIC_RELEASE);
    __atomic_add_fetch(&g_lock, 1, __ATOMIC_RELEASE);
    return 1;
}

uint32_t snap_seq(void) { return __atomic_load_n(&g_count, __ATOMIC_ACQUIRE); }

int snap_read(char *out, int cap, uint32_t *seq, uint64_t *served) {
    for (;;) {
        uint32_t a = __atomic_load_n(&g_lock, __ATOMIC_ACQUIRE);
        if (a & 1) continue;
        uint32_t c = __atomic_load_n(&g_count, __ATOMIC_RELAXED);
        int n = g_len;
        uint64_t s = g_served;
        if (n >= cap) n = cap - 1;
        if (c > 0) memcpy(out, g_text, (size_t)n);
        __atomic_thread_fence(__ATOMIC_ACQUIRE);
        if (__atomic_load_n(&g_lock, __ATOMIC_RELAXED) != a) continue;
        if (c == 0) return -1;
        out[n] = '\0';
        *seq = c;
        *served = s;
        return n;
    }
}
