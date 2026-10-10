/* Coexistence globals (WP1 manifest): they exist only to share the device
 * with Move. Registered as no-ops that log once, so a call that slipped past
 * caps.coexistsWithMove is visible, never a crash. Deleted in WP9. */
#include "globals.h"
#include "log.h"

static const char *const STUBS[] = {
    "host_suspend_overtake", "move_midi_inject_to_move", "shadow_set_overtake_mode",
    "shadow_set_overtake_suppress_master_volume", "shadow_set_overtake_suppress_sysex",
    "shadow_overtake_move_inject_active", "shadow_send_midi_to_dsp",
};
#define N_STUBS ((int)(sizeof STUBS / sizeof STUBS[0]))
static int g_logged[N_STUBS];

static JSValue stub(JSContext *ctx, JSValueConst t, int argc, JSValueConst *argv, int magic) {
    if (!g_logged[magic]++) mh_log("stub: %s called (no Move beside movy-host)", STUBS[magic]);
    return JS_NewInt32(ctx, 0);
}

void globals_register_stubs(JSContext *ctx, JSValue g) {
    for (int i = 0; i < N_STUBS; i++)
        JS_SetPropertyStr(ctx, g, STUBS[i], JS_NewCFunctionMagic(ctx, stub, STUBS[i], 1, JS_CFUNC_generic_magic, i));
}
