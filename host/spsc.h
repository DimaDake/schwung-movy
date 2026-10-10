/* A single-producer single-consumer ring of 4-byte USB-MIDI packets. Lock-free,
 * so the audio thread can be either end without ever blocking. */
#ifndef MH_SPSC_H
#define MH_SPSC_H

#include <stdint.h>
#include <string.h>

#define SPSC_CAP 1024u   /* power of two */

typedef struct {
    uint32_t head;        /* next write, producer-owned */
    uint32_t tail;        /* next read, consumer-owned */
    uint8_t pkt[SPSC_CAP][4];
} spsc_t;

static inline int spsc_push(spsc_t *q, const uint8_t p[4], uint32_t cap) {
    uint32_t h = __atomic_load_n(&q->head, __ATOMIC_RELAXED);
    uint32_t t = __atomic_load_n(&q->tail, __ATOMIC_ACQUIRE);
    if (h - t >= cap) return 0;
    memcpy(q->pkt[h & (SPSC_CAP - 1)], p, 4);
    __atomic_store_n(&q->head, h + 1, __ATOMIC_RELEASE);
    return 1;
}

static inline int spsc_pop(spsc_t *q, uint8_t p[4]) {
    uint32_t t = __atomic_load_n(&q->tail, __ATOMIC_RELAXED);
    uint32_t h = __atomic_load_n(&q->head, __ATOMIC_ACQUIRE);
    if (h == t) return 0;
    memcpy(p, q->pkt[t & (SPSC_CAP - 1)], 4);
    __atomic_store_n(&q->tail, t + 1, __ATOMIC_RELEASE);
    return 1;
}

static inline uint32_t spsc_count(spsc_t *q) {
    return __atomic_load_n(&q->head, __ATOMIC_ACQUIRE) - __atomic_load_n(&q->tail, __ATOMIC_ACQUIRE);
}

#endif
