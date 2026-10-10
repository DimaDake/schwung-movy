#define _GNU_SOURCE
#include <time.h>

#include "deltas.h"
#include "display.h"
#include "globals.h"
#include "js_display.h"
#include "js_host_common.h"
#include "log.h"
#include "midi_in.h"
#include "midi_out.h"
#include "movy_host.h"
#include "quickjs-libc.h"
#include "rt.h"
#include "ui.h"
#include "ui_eval.h"
#include "ui_js.h"

/* shadow_ui's overtake tick period. The tick IS movy's MIDI sampling
 * interval, so parity matters more than the plan's nominal 200 Hz. */
#define TICK_NS 2000000L

typedef struct { JSValue init, tick, midi_int, midi_ext, unload; } callbacks_t;

static JSContext *new_context(JSRuntime *rt) {
    js_std_set_worker_new_context_func(JS_NewCustomContext);
    js_std_init_handlers(rt);
    JSContext *ctx = JS_NewCustomContext(rt);   /* registers "std" and "os" */
    js_std_add_helpers(ctx, 0, NULL);
    JS_SetModuleLoaderFunc(rt, NULL, js_module_loader, NULL);
    JSValue g = JS_GetGlobalObject(ctx);
    js_display_register_bindings(ctx, g);
    JS_FreeValue(ctx, g);
    js_host_register_common(ctx);
    globals_register(ctx);
    return ctx;
}

/* Move's LEDs from before launch are not ours to keep: clear every LED movy
 * may not paint (shadow_ui's clearLedBatch set). init()'s writes coalesce
 * over these in the LED table, so nothing flashes. */
static void clear_leds(void) {
    static const uint8_t ccs[] = { 40, 41, 42, 43, 49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63,
                                   71, 72, 73, 74, 75, 76, 77, 78, 85, 86, 88, 118, 119 };
    uint8_t p[4];
    for (int n = 0; n < 100; n++) {
        if (!(n <= 7 || (n >= 16 && n <= 31) || n >= 68)) continue;
        p[0] = 0x09; p[1] = 0x90; p[2] = (uint8_t)n; p[3] = 0;
        midi_out_send(0, p, 4);
    }
    for (int i = 16; i <= 31; i++) { p[0] = 0x0B; p[1] = 0xB0; p[2] = (uint8_t)i; p[3] = 0; midi_out_send(0, p, 4); }
    for (unsigned i = 0; i < sizeof ccs; i++) { p[0] = 0x0B; p[1] = 0xB0; p[2] = ccs[i]; p[3] = 0; midi_out_send(0, p, 4); }
}

/* One tick's input: everything queued, encoders batched. -1 on a throw. */
static int drain_input(JSContext *ctx, callbacks_t *cb, deltas_t *d) {
    uint8_t pkt[4], out[9][3];
    while (midi_in_ui_pop(pkt)) {
        uint8_t cin = pkt[0] & 0x0F;
        int n = cin == 0x05 ? 1 : cin == 0x06 ? 2 : 3;
        if (pkt[0] >> 4 == 2) {
            if (JS_IsFunction(ctx, cb->midi_ext) && ui_js_call(ctx, cb->midi_ext, pkt + 1, n, "onMidiMessageExternal")) return -1;
            continue;
        }
        if (cin >= 0x08 && deltas_absorb(d, pkt + 1)) continue;
        if (JS_IsFunction(ctx, cb->midi_int) && ui_js_call(ctx, cb->midi_int, pkt + 1, n, "onMidiMessageInternal")) return -1;
    }
    int k = deltas_flush(d, out);
    for (int i = 0; i < k; i++)
        if (JS_IsFunction(ctx, cb->midi_int) && ui_js_call(ctx, cb->midi_int, out[i], 3, "onMidiMessageInternal")) return -1;
    return 0;
}

static void sleep_to(struct timespec *next) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    if (next->tv_sec == 0) *next = now;
    next->tv_nsec += TICK_NS;
    if (next->tv_nsec >= 1000000000L) { next->tv_nsec -= 1000000000L; next->tv_sec++; }
    /* Overran: drop the missed slots rather than sprint (shadow_ui's rule). */
    if (next->tv_sec < now.tv_sec || (next->tv_sec == now.tv_sec && next->tv_nsec < now.tv_nsec)) *next = now;
    else clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, next, NULL);
}

int ui_run(const char *ui_path) {
    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = new_context(rt);
    mh_log("ui: loading %s", ui_path);
    if (ui_eval_module_file(ctx, ui_path, 0) != 0) return 3;
    callbacks_t cb = {
        ui_js_global_fn(ctx, "init"), ui_js_global_fn(ctx, "tick"),
        ui_js_global_fn(ctx, "onMidiMessageInternal"), ui_js_global_fn(ctx, "onMidiMessageExternal"),
        ui_js_global_fn(ctx, "onUnload"),
    };
    clear_leds();
    int rc = 0;
    if (JS_IsFunction(ctx, cb.init) && ui_js_call(ctx, cb.init, NULL, 0, "init")) rc = 3;
    __atomic_store_n(&g_mh_ui_running, 1, __ATOMIC_RELEASE);
    mh_log("ui: running");

    deltas_t d = { { 0 }, 0 };
    struct timespec next = { 0, 0 };
    /* A throw ends the session, as it ejects a tool under shadow_ui — but
     * with its stack in debug.log first. */
    for (int tick = 0; !rc && !g_mh_quit; tick++) {
        if (drain_input(ctx, &cb, &d)) { rc = 3; break; }
        if (JS_IsFunction(ctx, cb.tick) && ui_js_call(ctx, cb.tick, NULL, 0, "tick")) { rc = 3; break; }
        ui_eval_service(ctx);
        display_publish(tick);
        rt_poll();
        sleep_to(&next);
    }
    __atomic_store_n(&g_mh_ui_running, 0, __ATOMIC_RELEASE);
    if (JS_IsFunction(ctx, cb.unload)) ui_js_call(ctx, cb.unload, NULL, 0, "onUnload");
    ui_eval_stop(ctx);
    mh_log("ui: stopped (rc %d)", rc);
    JS_FreeValue(ctx, cb.init); JS_FreeValue(ctx, cb.tick); JS_FreeValue(ctx, cb.midi_int);
    JS_FreeValue(ctx, cb.midi_ext); JS_FreeValue(ctx, cb.unload);
    js_std_free_handlers(rt);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return rc;
}
