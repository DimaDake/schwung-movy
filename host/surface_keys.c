#include "movy_host.h"
#include "surface_keys.h"

#define CC_SHIFT 49
#define CC_JOG_CLICK 3
#define NOTE_VOL_TOUCH 8

/* The power SysEx, packet by packet: {cin, b1, b2, b3}, -1 = any byte. */
static const int POWER[4][4] = {
    { 0x04, 0xF0, 0x00, 0x21 },
    { 0x04, 0x1D, 0x01, 0x01 },
    { 0x04, 0x3A, -1, -1 },
    { 0x06, 0x00, 0xF7, -1 },
};

static int g_stage, g_shift, g_vol_touch;
static int g_power;
static uint64_t g_fallback_at;

void surface_keys_reset(void) {
    g_stage = g_shift = g_vol_touch = 0;
    __atomic_store_n(&g_power, 0, __ATOMIC_RELAXED);
    __atomic_store_n(&g_fallback_at, 0, __ATOMIC_RELAXED);
}

static int matches(const uint8_t pkt[4], int stage) {
    for (int i = 0; i < 4; i++) {
        int want = POWER[stage][i];
        int got = i == 0 ? (pkt[0] & 0x0F) : pkt[i];
        if (want >= 0 && got != want) return 0;
    }
    return 1;
}

static void power_feed(const uint8_t pkt[4]) {
    if (matches(pkt, g_stage)) {
        if (++g_stage == 4) { g_stage = 0; __atomic_add_fetch(&g_power, 1, __ATOMIC_RELEASE); }
        return;
    }
    /* A broken run may itself be the start of the next one. */
    g_stage = matches(pkt, 0) ? 1 : 0;
}

void surface_keys_feed(const uint8_t pkt[4], uint64_t now_ms) {
    if (pkt[0] >> 4) return;   /* cable 0 only: the surface */
    uint8_t cin = pkt[0] & 0x0F;
    if (cin >= 0x04 && cin <= 0x07) { power_feed(pkt); return; }
    if (g_stage) g_stage = 0;
    uint8_t type = pkt[1] & 0xF0, d1 = pkt[2], d2 = pkt[3];
    if (type == 0xB0 && d1 == CC_SHIFT) g_shift = d2 > 0;
    if ((type == 0x90 || type == 0x80) && d1 == NOTE_VOL_TOUCH) g_vol_touch = type == 0x90 && d2 > 0;
    if (type == 0xB0 && d1 == CC_JOG_CLICK && d2 > 0 && g_shift && g_vol_touch
            && !__atomic_load_n(&g_fallback_at, __ATOMIC_RELAXED)) {
        __atomic_store_n(&g_fallback_at, now_ms ? now_ms : 1, __ATOMIC_RELEASE);
        g_mh_quit = 1;
    }
}

int surface_power_take(void) { return __atomic_exchange_n(&g_power, 0, __ATOMIC_ACQ_REL); }

uint64_t surface_fallback_at(void) { return __atomic_load_n(&g_fallback_at, __ATOMIC_ACQUIRE); }
