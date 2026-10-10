#include "midi_in.h"
#include "spsc.h"
#include "surface_keys.h"

/* shim: STEP_TAP_MS — a press shorter than this is a tap, longer is a hold. */
#define STEP_TAP_MS 500
#define CC_DELETE 119

static spsc_t g_ui, g_inject;
static uint32_t g_ui_dropped;
static uint32_t g_steps_mask;
static uint64_t g_step_press_ms[16];
static int g_delete_held;

void midi_in_reset(void) {
    g_ui.head = g_ui.tail = g_inject.head = g_inject.tail = 0;
    g_ui_dropped = 0;
    g_steps_mask = 0;
    g_delete_held = 0;
    for (int i = 0; i < 16; i++) g_step_press_ms[i] = 0;
}

static void track_state(uint8_t status, uint8_t d1, uint8_t d2, uint64_t now_ms) {
    uint8_t type = status & 0xF0;
    int on = type == 0x90 && d2 > 0;
    int off = type == 0x80 || (type == 0x90 && d2 == 0);
    if (d1 >= 16 && d1 <= 31 && (on || off)) {
        uint32_t bit = 1u << (d1 - 16);
        if (on) {
            __atomic_store_n(&g_step_press_ms[d1 - 16], now_ms, __ATOMIC_RELAXED);
            __atomic_fetch_or(&g_steps_mask, bit, __ATOMIC_RELEASE);
        } else {
            __atomic_fetch_and(&g_steps_mask, ~bit, __ATOMIC_RELEASE);
        }
    }
    if (type == 0xB0 && d1 == CC_DELETE) __atomic_store_n(&g_delete_held, d2 > 0, __ATOMIC_RELEASE);
}

int midi_in_feed(const uint8_t pkt[4], uint64_t now_ms) {
    uint8_t cable = pkt[0] >> 4, cin = pkt[0] & 0x0F;
    /* shadow_ui.c process_shadow_midi: only SysEx (4-7) and voice (8-E) CINs
     * reach a module; misc/realtime CINs are dropped. */
    if (cin < 0x04 || cin > 0x0E) return 0;
    if (cable == 0 && cin >= 0x08) track_state(pkt[1], pkt[2], pkt[3], now_ms);
    surface_keys_feed(pkt, now_ms);
    if (!spsc_push(&g_ui, pkt, SPSC_CAP)) __atomic_fetch_add(&g_ui_dropped, 1, __ATOMIC_RELAXED);
    uint8_t type = pkt[1] & 0xF0;
    return cable == 0 && cin >= 0x08 && (type == 0x90 || type == 0x80) && pkt[2] >= 10;
}

int midi_in_ui_pop(uint8_t pkt[4]) { return spsc_pop(&g_ui, pkt); }
uint32_t midi_in_ui_dropped(void) { return __atomic_load_n(&g_ui_dropped, __ATOMIC_RELAXED); }

/* EXACTLY one step: two held steps name no single phase (shim_plock_held_step). */
int midi_in_held_step(void) {
    uint32_t m = __atomic_load_n(&g_steps_mask, __ATOMIC_ACQUIRE);
    if (m == 0 || (m & (m - 1)) != 0) return -1;
    for (int i = 0; i < 16; i++) if (m & (1u << i)) return i;
    return -1;
}

int midi_in_held_step_is_hold(uint64_t now_ms) {
    int s = midi_in_held_step();
    if (s < 0) return 0;
    uint64_t at = __atomic_load_n(&g_step_press_ms[s], __ATOMIC_RELAXED);
    return at != 0 && now_ms - at >= STEP_TAP_MS;
}

int midi_in_delete_held(void) { return __atomic_load_n(&g_delete_held, __ATOMIC_ACQUIRE); }

int midi_in_inject_push(const uint8_t pkt[4]) { return spsc_push(&g_inject, pkt, MIDI_IN_INJECT_CAP); }
int midi_in_inject_pop(uint8_t pkt[4]) { return spsc_pop(&g_inject, pkt); }
uint32_t midi_in_inject_queued(void) { return spsc_count(&g_inject); }
