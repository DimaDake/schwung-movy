#include <stdio.h>
#include <string.h>

#include "globals.h"
#include "log.h"
#include "movy_host.h"

int js_bytes(JSContext *ctx, JSValueConst arr, uint8_t *out, int cap) {
    if (!JS_IsArray(ctx, arr)) return -1;
    JSValue lv = JS_GetPropertyStr(ctx, arr, "length");
    int32_t len = 0;
    JS_ToInt32(ctx, &len, lv);
    JS_FreeValue(ctx, lv);
    if (len < 0 || len > cap) return -1;
    for (int i = 0; i < len; i++) {
        JSValue e = JS_GetPropertyUint32(ctx, arr, (uint32_t)i);
        int32_t v = 0;
        JS_ToInt32(ctx, &v, e);
        JS_FreeValue(ctx, e);
        out[i] = (uint8_t)(v & 0xFF);
    }
    return len;
}

static JSValue js_host_exit_module(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    mh_log("host_exit_module: movy asked to close");
    g_mh_quit = 1;
    return JS_UNDEFINED;
}

static JSValue js_shadow_load_ui_module(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    const char *path = argc > 0 ? JS_ToCString(ctx, argv[0]) : NULL;
    if (!path) return JS_FALSE;
    int ok = ui_eval_module_file(ctx, path, 1) == 0;
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

/* console.log goes to debug.log under shadow_ui's own source name, "shadow":
 * the dev tools and the device tier find movy's lines by `[shadow].*[movy]`,
 * and this host is what shadow_ui was to movy — the JS UI host. */
static JSValue js_console_log(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    char line[2048];
    int off = 0;
    for (int i = 0; i < argc && off < (int)sizeof line - 1; i++) {
        const char *s = JS_ToCString(ctx, argv[i]);
        off += snprintf(line + off, sizeof line - (size_t)off, "%s%s", i ? " " : "", s ? s : "?");
        JS_FreeCString(ctx, s);
    }
    line[sizeof line - 1] = '\0';
    mh_log_src("shadow", "%s", line);
    return JS_UNDEFINED;
}

void globals_register(JSContext *ctx) {
    JSValue g = JS_GetGlobalObject(ctx);
    MH_FN(g, "host_exit_module", js_host_exit_module, 0);
    MH_FN(g, "shadow_load_ui_module", js_shadow_load_ui_module, 1);
    /* Read by movy as globalThis.overtakeParked; only a host that parks a
     * tool under Move sets it. */
    JS_SetPropertyStr(ctx, g, "overtakeParked", JS_FALSE);

    /* How src/platform/index.ts tells this host from shadow_ui. */
    JSValue info = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, info, "flavour", JS_NewString(ctx, "standalone"));
    JS_SetPropertyStr(ctx, info, "version", JS_NewString(ctx, MH_VERSION));
    JS_SetPropertyStr(ctx, info, "schwung", JS_NewString(ctx, SCHWUNG_TAG));
    JS_SetPropertyStr(ctx, info, "movy", JS_NewString(ctx, MOVY_COMMIT));
    JS_SetPropertyStr(ctx, g, "movy_host", info);

    JSValue console = JS_GetPropertyStr(ctx, g, "console");
    if (JS_IsObject(console)) {
        JS_SetPropertyStr(ctx, console, "log", JS_NewCFunction(ctx, js_console_log, "log", 1));
        JS_SetPropertyStr(ctx, console, "warn", JS_NewCFunction(ctx, js_console_log, "warn", 1));
        JS_SetPropertyStr(ctx, console, "error", JS_NewCFunction(ctx, js_console_log, "error", 1));
    }
    JS_FreeValue(ctx, console);

    globals_register_engine(ctx, g);
    globals_register_surface(ctx, g);
    globals_register_stubs(ctx, g);
    JS_FreeValue(ctx, g);
}
