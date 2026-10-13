/* QuickJS plumbing for ui.c: module evaluation and exceptions WITH a stack.
 * shadow_ui's eval_buf/callGlobalFunction print to stderr (/dev/null under a
 * launcher) and eject the tool; here every exception reaches debug.log. */
#include <stdio.h>
#include <string.h>

#include "globals.h"
#include "log.h"
#include "module_path.h"
#include "movy_host.h"
#include "quickjs-libc.h"
#include "ui_js.h"

char *ui_js_normalize(JSContext *ctx, const char *base, const char *name, void *opaque) {
    (void)opaque;
    char root[300], out[1024];
    snprintf(root, sizeof root, "%s/schwung", g_mh_module_dir);
    if (mh_module_path(base, name, root, out, sizeof out) != 0) {
        JS_ThrowReferenceError(ctx, "module path too long: %s", name);
        return NULL;
    }
    return js_strdup(ctx, out);
}

void ui_js_log_pin(void) {
    char path[300], tag[64] = "";
    snprintf(path, sizeof path, "%s/schwung/PIN", g_mh_module_dir);
    FILE *f = fopen(path, "r");
    if (f && fgets(tag, sizeof tag, f)) tag[strcspn(tag, "\n")] = '\0';
    if (f) fclose(f);
    if (*tag) mh_log("ui: schwung js pinned at %s (%s/schwung)", tag, g_mh_module_dir);
    else mh_log("ui: NO pinned schwung js at %s/schwung — every shared import will fail (deploy.sh ships it)", g_mh_module_dir);
}

void ui_js_log_exception(JSContext *ctx, const char *where) {
    JSValue ex = JS_GetException(ctx);
    const char *msg = JS_ToCString(ctx, ex);
    JSValue st = JS_IsError(ctx, ex) ? JS_GetPropertyStr(ctx, ex, "stack") : JS_UNDEFINED;
    const char *stack = JS_IsUndefined(st) ? NULL : JS_ToCString(ctx, st);
    mh_log_src("movy-ui", "EXCEPTION in %s: %s\n%s", where, msg ? msg : "?", stack ? stack : "(no stack)");
    JS_FreeCString(ctx, stack);
    JS_FreeCString(ctx, msg);
    JS_FreeValue(ctx, st);
    JS_FreeValue(ctx, ex);
}

static int counter;

int ui_eval_module_file(JSContext *ctx, const char *path, int unique) {
    size_t len;
    uint8_t *buf = js_load_file(ctx, &len, path);
    if (!buf) { mh_log("ui: cannot read %s", path); return -1; }
    /* A unique name bypasses QuickJS's module cache, as shadow_load_ui_module
     * does, so a reopened canvas re-evaluates. */
    char name[512];
    if (unique) snprintf(name, sizeof name, "%s#%d", path, ++counter);
    else snprintf(name, sizeof name, "%s", path);
    JSValue v = JS_Eval(ctx, (const char *)buf, len, name,
                        JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_STRICT | JS_EVAL_FLAG_COMPILE_ONLY);
    js_free(ctx, buf);
    if (!JS_IsException(v)) {
        js_module_set_import_meta(ctx, v, 1, 1);
        v = JS_EvalFunction(ctx, v);
    }
    /* Awaits top-level await (schwung-lib.ts's imports rely on it). */
    v = js_std_await(ctx, v);
    int rc = 0;
    if (JS_IsException(v)) { ui_js_log_exception(ctx, path); rc = -1; }
    JS_FreeValue(ctx, v);
    return rc;
}

int ui_js_call(JSContext *ctx, JSValue fn, const uint8_t *msg, int n, const char *where) {
    JSValue args[1];
    int argc = 0;
    if (msg) {
        args[0] = JS_NewArray(ctx);
        for (int i = 0; i < n; i++) JS_SetPropertyUint32(ctx, args[0], (uint32_t)i, JS_NewInt32(ctx, msg[i]));
        argc = 1;
    }
    JSValue r = JS_Call(ctx, fn, JS_UNDEFINED, argc, args);
    if (argc) JS_FreeValue(ctx, args[0]);
    int bad = JS_IsException(r);
    if (bad) ui_js_log_exception(ctx, where);
    JS_FreeValue(ctx, r);
    return bad ? -1 : 0;
}

JSValue ui_js_global_fn(JSContext *ctx, const char *name) {
    JSValue g = JS_GetGlobalObject(ctx);
    JSValue f = JS_GetPropertyStr(ctx, g, name);
    JS_FreeValue(ctx, g);
    if (JS_IsFunction(ctx, f)) return f;
    JS_FreeValue(ctx, f);
    return JS_UNDEFINED;
}
