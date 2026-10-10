/* The engine param channel as movy calls it: host_module_* (the door
 * src/host/param.ts uses) and the slot API's "overtake_dsp:" namespace, both
 * onto the param queue. There are no schwung slots here, so every other slot
 * key answers like an absent slot (null / false). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "globals.h"
#include "log.h"
#include "movy_host.h"
#include "param_queue.h"
#include "vtable.h"

#define NS "overtake_dsp:"
#define GET_TIMEOUT_MS 500
#define SET_TIMEOUT_MS 500

static char g_dsp_path[300];

/* Host-level keys the shim answered itself. `load` reloads OUR dsp.so, never
 * the path the UI names: that path is the overtake install's, and the engine
 * is the host's to choose (a dev flavour beside an older install must not
 * pick up its engine). Returns 1 when handled. */
static int host_key_set(const char *key, const char *value) {
    if (strcmp(key, "load") == 0) {
        mh_log("engine: UI asked for load %s; reloading %s", value, g_dsp_path);
        engine_load(g_dsp_path, g_mh_module_dir);
        return 1;
    }
    if (strcmp(key, "unload") == 0) { engine_unload(); return 1; }
    return 0;
}

static JSValue engine_get(JSContext *ctx, const char *key) {
    if (strcmp(key, "__ready") == 0) return JS_NewString(ctx, engine_loaded() ? "1" : "0");
    char *buf = malloc(PQ_VALUE_CAP);
    if (!buf) return JS_NULL;
    int n = engine_loaded() ? pq_get(key, buf, PQ_VALUE_CAP, GET_TIMEOUT_MS) : -1;
    JSValue v = n >= 0 ? JS_NewStringLen(ctx, buf, (size_t)n) : JS_NULL;
    free(buf);
    return v;
}

static int engine_set(const char *key, const char *value, int timeout_ms) {
    if (host_key_set(key, value)) return 1;
    return pq_set(key, value, timeout_ms);
}

static JSValue bulk(JSContext *ctx, pq_kind_t kind, JSValueConst payload) {
    const char *p = JS_ToCString(ctx, payload);
    if (!p) return JS_NULL;
    char *out = kind == PQ_BULK_GET ? malloc(PQ_VALUE_CAP) : NULL;
    int n = pq_bulk(kind, p, out, out ? PQ_VALUE_CAP : 0, GET_TIMEOUT_MS);
    JS_FreeCString(ctx, p);
    JSValue v = kind == PQ_BULK_SET ? JS_NewBool(ctx, n >= 0)
              : n >= 0 ? JS_NewStringLen(ctx, out, (size_t)n) : JS_NULL;
    free(out);
    return v;
}

static JSValue js_host_module_get_param(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    const char *k = argc > 0 ? JS_ToCString(ctx, argv[0]) : NULL;
    if (!k) return JS_NULL;
    JSValue v = engine_get(ctx, k);
    JS_FreeCString(ctx, k);
    return v;
}

static JSValue set_common(JSContext *ctx, const char *k, JSValueConst val, int timeout_ms) {
    const char *v = JS_ToCString(ctx, val);
    int ok = k && v && engine_set(k, v, timeout_ms);
    JS_FreeCString(ctx, v);
    return JS_NewBool(ctx, ok);
}

static JSValue js_host_module_set_param(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    if (argc < 2) return JS_FALSE;
    const char *k = JS_ToCString(ctx, argv[0]);
    JSValue r = set_common(ctx, k, argv[1], 0);
    JS_FreeCString(ctx, k);
    return r;
}

static JSValue js_host_module_set_param_blocking(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    if (argc < 2) return JS_FALSE;
    int32_t ms = SET_TIMEOUT_MS;
    if (argc > 2 && JS_ToInt32(ctx, &ms, argv[2]) == 0 && ms <= 0) ms = SET_TIMEOUT_MS;
    const char *k = JS_ToCString(ctx, argv[0]);
    JSValue r = set_common(ctx, k, argv[1], ms);
    JS_FreeCString(ctx, k);
    return r;
}

static JSValue js_host_module_get_params(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return argc > 0 ? bulk(ctx, PQ_BULK_GET, argv[0]) : JS_NULL;
}

static JSValue js_host_module_set_params(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return argc > 0 ? bulk(ctx, PQ_BULK_SET, argv[0]) : JS_FALSE;
}

/* shadow_get_param(slot, key): only "overtake_dsp:<key>" reaches anything. */
static const char *engine_key(JSContext *ctx, JSValueConst key) {
    const char *k = JS_ToCString(ctx, key);
    if (k && strncmp(k, NS, strlen(NS)) != 0) { JS_FreeCString(ctx, k); return NULL; }
    return k;
}

static JSValue js_shadow_get_param(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    const char *k = argc > 1 ? engine_key(ctx, argv[1]) : NULL;
    if (!k) return JS_NULL;
    JSValue v = engine_get(ctx, k + strlen(NS));
    JS_FreeCString(ctx, k);
    return v;
}

static JSValue slot_set(JSContext *ctx, int argc, JSValueConst *argv, int timeout_ms) {
    const char *k = argc > 2 ? engine_key(ctx, argv[1]) : NULL;
    if (!k) return JS_FALSE;
    const char *v = JS_ToCString(ctx, argv[2]);
    int ok = v && engine_set(k + strlen(NS), v, timeout_ms);
    JS_FreeCString(ctx, v);
    JS_FreeCString(ctx, k);
    return JS_NewBool(ctx, ok);
}

static JSValue js_shadow_set_param(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return slot_set(ctx, argc, argv, 0);
}

static JSValue js_shadow_set_param_timeout(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    int32_t ms = SET_TIMEOUT_MS;
    if (argc > 3) JS_ToInt32(ctx, &ms, argv[3]);
    return slot_set(ctx, argc, argv, ms > 0 ? ms : SET_TIMEOUT_MS);
}

static JSValue js_shadow_get_params(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return argc > 2 ? bulk(ctx, PQ_BULK_GET, argv[2]) : JS_NULL;
}

static JSValue js_shadow_set_params(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return argc > 2 ? bulk(ctx, PQ_BULK_SET, argv[2]) : JS_FALSE;
}

void globals_register_engine(JSContext *ctx, JSValue g) {
    snprintf(g_dsp_path, sizeof g_dsp_path, "%s/dsp.so", g_mh_module_dir);
    MH_FN(g, "host_module_get_param", js_host_module_get_param, 1);
    MH_FN(g, "host_module_set_param", js_host_module_set_param, 2);
    MH_FN(g, "host_module_set_param_blocking", js_host_module_set_param_blocking, 3);
    MH_FN(g, "host_module_get_params", js_host_module_get_params, 1);
    MH_FN(g, "host_module_set_params", js_host_module_set_params, 1);
    MH_FN(g, "shadow_get_param", js_shadow_get_param, 2);
    MH_FN(g, "shadow_set_param", js_shadow_set_param, 3);
    MH_FN(g, "shadow_set_param_timeout", js_shadow_set_param_timeout, 4);
    MH_FN(g, "shadow_get_params", js_shadow_get_params, 3);
    MH_FN(g, "shadow_set_params", js_shadow_set_params, 3);
}
