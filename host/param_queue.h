/* Engine param requests from any thread, serviced by the audio thread between
 * blocks — the only place the engine may be called (movy_host.h).
 *
 * This replaces the overtake param SHM, a SINGLE slot where a second write
 * before the shim consumed the first silently replaced it (movy CLAUDE.md:
 * "engine sets must be blocking"). Here every request gets its own record and
 * a FIFO place, so no write is ever lost and none can starve another; a
 * non-blocking set is simply one nobody waits for. */
#ifndef MH_PARAM_QUEUE_H
#define MH_PARAM_QUEUE_H

#include <stdint.h>

/* The overtake param value buffer (shadow_constants.h SHADOW_PARAM_VALUE_LEN). */
#define PQ_VALUE_CAP 131072
#define PQ_KEY_CAP 64

typedef enum { PQ_GET, PQ_SET, PQ_BULK_GET, PQ_BULK_SET } pq_kind_t;

typedef struct pq_req {
    struct pq_req *next;
    pq_kind_t kind;
    char key[PQ_KEY_CAP];
    char *value;          /* SET/BULK: the payload; GET/BULK_GET: the answer */
    int result;           /* answer length, or -1 */
    int state;            /* 0 queued, 1 done, 2 abandoned by its waiter */
    int waited;           /* someone is (or was) waiting for it */
} pq_req_t;

/* Callers. timeout_ms <= 0 means "do not wait" (SET only). */
int pq_get(const char *key, char *out, int cap, int timeout_ms);            /* len or -1 */
int pq_set(const char *key, const char *value, int timeout_ms);            /* 1 applied/queued, 0 timed out */
int pq_bulk(pq_kind_t kind, const char *payload, char *out, int cap, int timeout_ms);

/* Audio thread: service at most `max` requests through `fn`, in order. */
typedef void (*pq_service_fn)(void *ctx, pq_req_t *r);
int pq_service(pq_service_fn fn, void *ctx, int max);
int pq_depth(void);

#endif
