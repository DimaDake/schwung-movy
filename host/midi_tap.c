#include <stdio.h>
#include <string.h>

#include "midi_tap.h"

#define MASK (MIDI_TAP_CAP - 1)

/* One producer (the audio thread) that never waits: it overwrites the oldest
 * entry, and `commit` (the entry's 1-based index) lets the reader tell an
 * entry it raced from a whole one. */
typedef struct { uint32_t commit; uint32_t frame; uint8_t pkt[4]; } ev_t;

static ev_t g_ev[MIDI_TAP_CAP];
static uint32_t g_head, g_on, g_cursor;

void midi_tap_record(uint64_t frame, const uint8_t pkt[4]) {
    if (!__atomic_load_n(&g_on, __ATOMIC_RELAXED)) return;
    uint32_t i = g_head + 1;
    ev_t *e = &g_ev[(i - 1) & MASK];
    __atomic_store_n(&e->commit, 0, __ATOMIC_RELAXED);
    __atomic_thread_fence(__ATOMIC_RELEASE);
    e->frame = (uint32_t)frame;
    memcpy(e->pkt, pkt, 4);
    __atomic_store_n(&e->commit, i, __ATOMIC_RELEASE);
    __atomic_store_n(&g_head, i, __ATOMIC_RELEASE);
}

void midi_tap_subscribe(void) {
    g_cursor = __atomic_load_n(&g_head, __ATOMIC_ACQUIRE);
    __atomic_store_n(&g_on, 1, __ATOMIC_RELEASE);
}

void midi_tap_unsubscribe(void) { __atomic_store_n(&g_on, 0, __ATOMIC_RELEASE); }

int midi_tap_dump(tb_reply_t *o) {
    if (!__atomic_load_n(&g_on, __ATOMIC_ACQUIRE)) {
        snprintf(o->buf, (size_t)o->cap, "ERR DUMP: not subscribed (SUBSCRIBE midi_out first)");
        return 0;
    }
    uint32_t head = __atomic_load_n(&g_head, __ATOMIC_ACQUIRE), dropped = 0;
    if (head - g_cursor > MIDI_TAP_CAP) { dropped = head - g_cursor - MIDI_TAP_CAP; g_cursor = head - MIDI_TAP_CAP; }
    /* `EV ffffffff ffffffff\n` is 21 bytes; the header gets the front. */
    const int hdr = 48;
    int used = hdr, count = 0;
    for (; g_cursor != head && used + 32 < o->cap; g_cursor++) {
        ev_t *e = &g_ev[g_cursor & MASK], c;
        uint32_t want = g_cursor + 1;
        if (__atomic_load_n(&e->commit, __ATOMIC_ACQUIRE) != want) { dropped++; continue; }
        memcpy(&c, e, sizeof c);
        __atomic_thread_fence(__ATOMIC_ACQUIRE);
        if (__atomic_load_n(&e->commit, __ATOMIC_RELAXED) != want) { dropped++; continue; }
        used += snprintf(o->buf + used, (size_t)(o->cap - used), "\nEV %08x %02x%02x%02x%02x",
                         c.frame, c.pkt[0], c.pkt[1], c.pkt[2], c.pkt[3]);
        count++;
    }
    char h[hdr];
    int hl = snprintf(h, sizeof h, "OK count=%d dropped=%u", count, dropped);
    memmove(o->buf + hl, o->buf + hdr, (size_t)(used - hdr));
    memcpy(o->buf, h, (size_t)hl);
    memcpy(o->buf + hl + used - hdr, "\nEND", 5);
    return 0;
}
