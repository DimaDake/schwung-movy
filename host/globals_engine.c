/* The engine param channel as movy calls it: host_module_* (the door
 * src/host/param.ts uses) and the slot API's "overtake_dsp:" namespace, both
 * onto the param queue, plus the status snapshot (status_snap.h). There are
 * no schwung slots here, so every other slot key answers like an absent slot
 * (null / false). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "globals.h"
#include "log.h"
#include "movy_host.h"
#include "param_queue.h"
#include "status_snap.h"
#include "vtable.h"

#define NS "overtake_dsp:"
#define GET_TIMEOUT_MS 500
#define SET_TIMEOUT_MS 500

static JSValue engine_get(JSContext *ctx, const char *key) {
    if (strcmp(key, "__ready") == 0) return JS_NewString(ctx, engine_loaded() ? "1" : "0");
    char *buf = malloc(PQ_VALUE_CAP);
    if (!buf) return JS_NULL;
    int n = engine_loaded() ? pq_get(key, buf, PQ_VALUE_CAP, GET_TIMEOUT_MS) : -1;
    JSValue v = n >= 0 ? JS_NewStringLen(ctx, buf, (size_t)n) : JS_NULL;
    free(buf);
    return v;
}

/* movy-host loads its own dsp.so before the UI starts and never reloads it
 * (WP10), so a set with no engine has nowhere to go: refused, not queued. */
static int engine_set(const char *key, const char *value, int timeout_ms) {
    return engine_loaded() && pq_set(key, value, timeout_ms);
}

static JSValue bulk(JSContext *ctx, pq_kind_t kind, JSValueConst payload) {
    const char *p = JS_ToCString(ctx, payload);
    if (!p) return JS_NULL;
    char *out = kind == PQ_BULK_GET ? malloc(PQ_VALUE_CAP) : NULL;
    /* A bulk set waits for nothing, like a single one: the queue keeps it. */
    int loaded = engine_loaded();
    int n = !loaded ? -1 : pq_bulk(kind, p, out, out ? PQ_VALUE_CAP : 0, kind == PQ_BULK_SET ? 0 : GET_TIMEOUT_MS);
    JS_FreeCString(ctx, p);
    JSValue v = kind == PQ_BULK_SET ? JS_NewBool(ctx, loaded)
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

/* movy_engine_snapshot_seq(): publishes so far (0 = none), cheap enough to
 * ask every tick. movy_engine_snapshot(): { seq, served, text } or null. */
static JSValue js_snapshot_seq(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return JS_NewUint32(ctx, snap_seq());
}

static JSValue js_snapshot(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    static char buf[STATUS_SNAP_CAP];
    uint32_t seq;
    uint64_t served;
    int n = snap_read(buf, sizeof buf, &seq, &served);
    if (n < 0) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "seq", JS_NewUint32(ctx, seq));
    JS_SetPropertyStr(ctx, o, "served", JS_NewFloat64(ctx, (double)served));
    JS_SetPropertyStr(ctx, o, "text", JS_NewStringLen(ctx, buf, (size_t)n));
    return o;
}

/* movy_engine_submitted(): requests queued so far. A snapshot whose `served`
 * has reached it reflects every request made before the call. */
static JSValue js_submitted(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return JS_NewFloat64(ctx, (double)pq_submitted());
}

void globals_register_engine(JSContext *ctx, JSValue g) {
    MH_FN(g, "movy_engine_snapshot_seq", js_snapshot_seq, 0);
    MH_FN(g, "movy_engine_snapshot", js_snapshot, 0);
    MH_FN(g, "movy_engine_submitted", js_submitted, 0);
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
