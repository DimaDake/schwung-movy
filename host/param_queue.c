#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "param_queue.h"

/* The audio thread holds g_mu only to unlink a request or to flip its state —
 * never across an engine call — and priority inheritance keeps a preempted
 * UI holder from stalling it. */
static pthread_mutex_t g_mu;
static pthread_cond_t g_done;
static pq_req_t *g_head, *g_tail;
static int g_depth;
static pthread_once_t g_once = PTHREAD_ONCE_INIT;

static void init_once(void) {
    pthread_mutexattr_t ma;
    pthread_mutexattr_init(&ma);
    pthread_mutexattr_setprotocol(&ma, PTHREAD_PRIO_INHERIT);
    pthread_mutex_init(&g_mu, &ma);
    pthread_condattr_t ca;
    pthread_condattr_init(&ca);
#ifdef __linux__
    pthread_condattr_setclock(&ca, CLOCK_MONOTONIC);
#endif
    pthread_cond_init(&g_done, &ca);
}

static void deadline(struct timespec *ts, int ms) {
#ifdef __linux__
    clock_gettime(CLOCK_MONOTONIC, ts);
#else
    clock_gettime(CLOCK_REALTIME, ts);
#endif
    ts->tv_sec += ms / 1000;
    ts->tv_nsec += (long)(ms % 1000) * 1000000L;
    if (ts->tv_nsec >= 1000000000L) { ts->tv_sec++; ts->tv_nsec -= 1000000000L; }
}

static void req_free(pq_req_t *r) { free(r->value); free(r); }

/* Queues r and, when timeout_ms > 0, waits for it. Returns 1 if it completed;
 * on a timeout ownership passes to the audio thread, which frees it. */
static int submit(pq_req_t *r, int timeout_ms) {
    pthread_once(&g_once, init_once);
    r->waited = timeout_ms > 0;
    pthread_mutex_lock(&g_mu);
    if (g_tail) g_tail->next = r; else g_head = r;
    g_tail = r;
    g_depth++;
    if (!r->waited) { pthread_mutex_unlock(&g_mu); return 1; }
    struct timespec ts;
    deadline(&ts, timeout_ms);
    int rc = 0;
    while (r->state == 0 && rc != ETIMEDOUT) rc = pthread_cond_timedwait(&g_done, &g_mu, &ts);
    int done = r->state == 1;
    if (!done) r->state = 2;
    pthread_mutex_unlock(&g_mu);
    return done;
}

static pq_req_t *req_new(pq_kind_t kind, const char *key, const char *value, int cap) {
    pq_req_t *r = calloc(1, sizeof *r);
    if (!r) return NULL;
    r->kind = kind;
    r->result = -1;
    if (key) strncpy(r->key, key, PQ_KEY_CAP - 1);
    size_t vlen = value ? strlen(value) : 0;
    size_t need = (size_t)cap > vlen + 1 ? (size_t)cap : vlen + 1;
    r->value = malloc(need);
    if (!r->value) { free(r); return NULL; }
    memcpy(r->value, value ? value : "", vlen + 1);
    return r;
}

int pq_get(const char *key, char *out, int cap, int timeout_ms) {
    pq_req_t *r = req_new(PQ_GET, key, NULL, PQ_VALUE_CAP);
    if (!r) return -1;
    if (!submit(r, timeout_ms > 0 ? timeout_ms : 1000)) return -1;
    int n = r->result;
    if (n >= 0) {
        if (n >= cap) n = cap - 1;
        memcpy(out, r->value, (size_t)n);
        out[n] = '\0';
    }
    req_free(r);
    return n;
}

int pq_set(const char *key, const char *value, int timeout_ms) {
    pq_req_t *r = req_new(PQ_SET, key, value, 0);
    if (!r) return 0;
    /* An unwaited request belongs to the audio thread from the moment it is
     * queued, so nothing of it may be read after submit(). */
    int wait = timeout_ms > 0;
    if (!submit(r, timeout_ms)) return 0;
    if (wait) req_free(r);
    return 1;
}

int pq_bulk(pq_kind_t kind, const char *payload, char *out, int cap, int timeout_ms) {
    pq_req_t *r = req_new(kind, "", payload, kind == PQ_BULK_GET ? PQ_VALUE_CAP : 0);
    if (!r) return -1;
    if (!submit(r, timeout_ms > 0 ? timeout_ms : 1000)) return -1;
    int n = r->result;
    if (n >= 0 && out && cap > 0) {
        if (n >= cap) n = cap - 1;
        memcpy(out, r->value, (size_t)n);
        out[n] = '\0';
    }
    req_free(r);
    return n;
}

int pq_service(pq_service_fn fn, void *ctx, int max) {
    pthread_once(&g_once, init_once);
    int served = 0;
    while (served < max) {
        pthread_mutex_lock(&g_mu);
        pq_req_t *r = g_head;
        if (r) { g_head = r->next; if (!g_head) g_tail = NULL; g_depth--; }
        /* A write whose waiter gave up is still applied: only a READ nobody
         * will look at is skipped. */
        int skip = r && r->state == 2 && (r->kind == PQ_GET || r->kind == PQ_BULK_GET);
        pthread_mutex_unlock(&g_mu);
        if (!r) break;
        if (!skip) fn(ctx, r);
        served++;
        pthread_mutex_lock(&g_mu);
        int free_it = !r->waited || r->state == 2;
        r->state = free_it ? r->state : 1;
        pthread_mutex_unlock(&g_mu);
        if (free_it) req_free(r);
        else pthread_cond_broadcast(&g_done);
    }
    return served;
}

int pq_depth(void) {
    pthread_once(&g_once, init_once);
    pthread_mutex_lock(&g_mu);
    int d = g_depth;
    pthread_mutex_unlock(&g_mu);
    return d;
}
