#include <string.h>

#include "log.h"
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
static int g_power, g_ack;
static uint8_t g_status;   /* the last 3A bitfield: a press is the button bit's rising edge */
static uint64_t g_fallback_at;

void surface_keys_reset(void) {
    g_stage = g_shift = g_vol_touch = 0;
    __atomic_store_n(&g_power, 0, __ATOMIC_RELAXED);
    g_ack = g_status = 0;
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

/* The power button has been reported to miss presses: every way a run ends is logged, so a
 * miss in debug.log says whether the SysEx never came, came with another command byte, or
 * was broken up. */
static mh_log_limit_t g_power_lim, g_status_lim;
static uint8_t g_cmd[3];
#define STATUS_BUTTON 0x08

static void log_broken(const uint8_t pkt[4], uint64_t now_ms) {
    if (mh_log_limit(&g_power_lim, now_ms, 8))
        mh_log("power SysEx run broken at packet %d by %02x %02x %02x %02x", g_stage + 1, pkt[0], pkt[1], pkt[2], pkt[3]);
}

static void power_feed(const uint8_t pkt[4], uint64_t now_ms) {
    if (matches(pkt, g_stage)) {
        if (g_stage == 2) memcpy(g_cmd, pkt + 1, 3);
        if (++g_stage == 4) {
            g_stage = 0;
            /* 3A is a system-status report: byte 2 is a bitfield (08 = power button held; 10, 20,
             * 01 follow the power source), byte 3 the battery percentage. It is re-sent on every
             * change, battery drops included (with a cable-14 CC 0 twin), so a press is the
             * button bit going up, not any report: the bit stays set through a battery report
             * mid-hold, and other bits stay set through a tap (29 -> 21 while charging). Every
             * report is still answered: silence is what stops the button. */
            g_ack++;
            uint8_t was = g_status;
            g_status = g_cmd[1];
            if ((g_status & STATUS_BUTTON) && !(was & STATUS_BUTTON)) {
                int n = __atomic_add_fetch(&g_power, 1, __ATOMIC_RELEASE);
                mh_log("power button: SysEx cmd %02x id %02x val %02x (%d untaken)", g_cmd[0], g_cmd[1], g_cmd[2], n);
            } else if (mh_log_limit(&g_status_lim, now_ms, 8)) {
                mh_log("system status: SysEx cmd %02x id %02x val %02x (not the power button)", g_cmd[0], g_cmd[1], g_cmd[2]);
            }
        }
        return;
    }
    if (g_stage == 2 && (pkt[0] & 0x0F) == 0x04) {
        if (mh_log_limit(&g_power_lim, now_ms, 8))
            mh_log("surface SysEx with command %02x %02x %02x: not the power button", pkt[1], pkt[2], pkt[3]);
    } else if (g_stage) {
        log_broken(pkt, now_ms);
    }
    /* A broken run may itself be the start of the next one. */
    g_stage = matches(pkt, 0) ? 1 : 0;
}

void surface_keys_feed(const uint8_t pkt[4], uint64_t now_ms) {
    if (pkt[0] >> 4) return;   /* cable 0 only: the surface */
    uint8_t cin = pkt[0] & 0x0F;
    if (cin >= 0x04 && cin <= 0x07) { power_feed(pkt, now_ms); return; }
    if (g_stage) { log_broken(pkt, now_ms); g_stage = 0; }
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

int surface_power_ack_take(void) { int n = g_ack; g_ack = 0; return n; }
