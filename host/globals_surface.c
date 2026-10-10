/* Surface globals: LED/MIDI out, the held-step state page_controller reads,
 * and the few shadow_ui answers the shared JS asks for. */
#include <stdio.h>

#include "globals.h"
#include "midi_in.h"
#include "midi_out.h"
#include "movy_host.h"

static JSValue send(JSContext *ctx, int cable, int argc, JSValueConst *argv) {
    uint8_t buf[1024];
    int n = argc > 0 ? js_bytes(ctx, argv[0], buf, sizeof buf) : -1;
    return JS_NewBool(ctx, n > 0 && midi_out_send(cable, buf, n));
}

static JSValue js_move_midi_internal_send(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return send(ctx, 0, argc, argv); }
static JSValue js_move_midi_external_send(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return send(ctx, 2, argc, argv); }
static JSValue js_shadow_get_held_step(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return JS_NewInt32(ctx, midi_in_held_step()); }
static JSValue js_shadow_get_held_step_is_hold(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return JS_NewInt32(ctx, midi_in_held_step_is_hold(mh_now_ms())); }
static JSValue js_shadow_get_delete_held(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return JS_NewInt32(ctx, midi_in_delete_held()); }
/* No schwung scenes and no schwung slot UI here: the answers shadow_ui gives
 * with no shared control block. */
static JSValue js_shadow_get_scene_state(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return JS_NULL; }
static JSValue js_shadow_get_ui_slot(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return JS_NewInt32(ctx, 0); }
/* movy-host always owns the screen (1 = the shadow display is up). */
static JSValue js_shadow_get_display_mode(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return JS_NewInt32(ctx, 1); }
/* Nothing to block pads FROM: Move is not running. */
static JSValue js_host_pad_block(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return JS_TRUE; }
static JSValue js_host_send_screenreader(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) { return JS_UNDEFINED; }

static JSValue js_shadow_get_pad_led_snapshot(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv) {
    uint8_t pads[32];
    midi_out_pad_snapshot(pads);
    JSValue o = JS_NewObject(ctx);
    for (int i = 0; i < 32; i++) {
        char key[4];
        snprintf(key, sizeof key, "%d", 68 + i);
        JS_SetPropertyStr(ctx, o, key, JS_NewInt32(ctx, pads[i]));
    }
    return o;
}

void globals_register_surface(JSContext *ctx, JSValue g) {
    MH_FN(g, "move_midi_internal_send", js_move_midi_internal_send, 1);
    MH_FN(g, "move_midi_external_send", js_move_midi_external_send, 1);
    MH_FN(g, "shadow_get_held_step", js_shadow_get_held_step, 0);
    MH_FN(g, "shadow_get_held_step_is_hold", js_shadow_get_held_step_is_hold, 0);
    MH_FN(g, "shadow_get_delete_held", js_shadow_get_delete_held, 0);
    MH_FN(g, "shadow_get_scene_state", js_shadow_get_scene_state, 0);
    MH_FN(g, "shadow_get_ui_slot", js_shadow_get_ui_slot, 0);
    MH_FN(g, "shadow_get_display_mode", js_shadow_get_display_mode, 0);
    MH_FN(g, "shadow_get_pad_led_snapshot", js_shadow_get_pad_led_snapshot, 0);
    MH_FN(g, "host_pad_block", js_host_pad_block, 1);
    MH_FN(g, "host_send_screenreader", js_host_send_screenreader, 1);
}
