#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "log.h"
#include "movy_host.h"
#include "ui_eval.h"

/* A promise gets this long to settle, in ticks of the UI loop. */
#define PROMISE_TICKS 2500

/* One request at a time: the bus serves one client, one line at a time. */
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_cv = PTHREAD_COND_INITIALIZER;
static char *g_src, *g_out;
static int g_cap, g_state;   /* 0 idle, 1 asked, 2 running (promise), 3 answered */
/* A request the bus gave up on may still settle later; its answer must not
 * land on the NEXT request, so every request has an id. */
static unsigned g_id;

void ui_eval_request(const char *src, char *out, int cap, int timeout_ms) {
#ifndef MOVY_TESTBUS_EVAL
    (void)src; (void)timeout_ms;
    snprintf(out, (size_t)cap, "ERR UI_EVAL: not built in");
#else
    pthread_mutex_lock(&g_mu);
    if (!__atomic_load_n(&g_mh_ui_running, __ATOMIC_ACQUIRE)) {
        pthread_mutex_unlock(&g_mu);
        snprintf(out, (size_t)cap, "ERR UI_EVAL: the UI is not running");
        return;
    }
    g_src = strdup(src);
    g_id++;
    g_out = out;
    g_cap = cap;
    g_state = 1;
    struct timespec dl;
    clock_gettime(CLOCK_REALTIME, &dl);
    dl.tv_sec += timeout_ms / 1000;
    dl.tv_nsec += (long)(timeout_ms % 1000) * 1000000L;
    if (dl.tv_nsec >= 1000000000L) { dl.tv_sec++; dl.tv_nsec -= 1000000000L; }
    while (g_state != 3)
        if (pthread_cond_timedwait(&g_cv, &g_mu, &dl)) break;
    if (g_state != 3) snprintf(out, (size_t)cap, "ERR UI_EVAL: no answer in %d ms (UI wedged?)", timeout_ms);
    /* Abandoned or answered, the UI thread must not write into `out` again. */
    g_state = 0;
    g_out = NULL;
    free(g_src);
    g_src = NULL;
    pthread_mutex_unlock(&g_mu);
#endif
}

#ifdef MOVY_TESTBUS_EVAL
static JSValue g_promise;
static int g_has_promise, g_ticks;
static unsigned g_serving;

static void answer(JSContext *ctx, JSValue v, int threw) {
    pthread_mutex_lock(&g_mu);
    int live = g_out && g_serving == g_id;
    if (live) {
        if (threw) {
            const char *msg = JS_ToCString(ctx, v);
            JSValue st = JS_IsError(ctx, v) ? JS_GetPropertyStr(ctx, v, "stack") : JS_UNDEFINED;
            const char *stack = JS_IsUndefined(st) ? NULL : JS_ToCString(ctx, st);
            snprintf(g_out, (size_t)g_cap, "ERR UI_EVAL: %s %s", msg ? msg : "?", stack ? stack : "");
            JS_FreeCString(ctx, stack);
            JS_FreeCString(ctx, msg);
            JS_FreeValue(ctx, st);
        } else {
            JSValue j = JS_JSONStringify(ctx, v, JS_UNDEFINED, JS_UNDEFINED);
            const char *s = JS_IsException(j) ? NULL : JS_ToCString(ctx, j);
            if (JS_IsException(j)) JS_FreeValue(ctx, JS_GetException(ctx));
            snprintf(g_out, (size_t)g_cap, "OK %s", s ? s : "null");   /* undefined → null */
            JS_FreeCString(ctx, s);
            JS_FreeValue(ctx, j);
        }
        for (char *c = g_out; *c; c++) if (*c == '\n') *c = ' ';
        g_state = 3;
        pthread_cond_signal(&g_cv);
    }
    pthread_mutex_unlock(&g_mu);
}
#endif

void ui_eval_service(JSContext *ctx) {
#ifdef MOVY_TESTBUS_EVAL
    pthread_mutex_lock(&g_mu);
    int st = g_state;
    char *src = st == 1 ? strdup(g_src) : NULL;
    if (st == 1) { g_state = 2; g_serving = g_id; }
    pthread_mutex_unlock(&g_mu);

    if (src) {
        /* A newer request supersedes a promise nobody waits for any more. */
        if (g_has_promise) { JS_FreeValue(ctx, g_promise); g_has_promise = 0; }
        JSValue v = JS_Eval(ctx, src, strlen(src), "<UI_EVAL>", JS_EVAL_TYPE_GLOBAL);
        free(src);
        if (JS_IsException(v)) { JSValue ex = JS_GetException(ctx); answer(ctx, ex, 1); JS_FreeValue(ctx, ex); return; }
        if (JS_PromiseState(ctx, v) == (JSPromiseStateEnum)-1) { answer(ctx, v, 0); JS_FreeValue(ctx, v); return; }
        g_promise = v;
        g_has_promise = 1;
        g_ticks = 0;
    }
    if (!g_has_promise) return;
    /* Only while an eval's promise is open: shadow_ui never runs the job
     * queue, so movy-host does not either outside this verb. */
    JSContext *jc;
    for (int i = 0; i < 64 && JS_ExecutePendingJob(JS_GetRuntime(ctx), &jc) > 0; i++) { }
    JSPromiseStateEnum ps = JS_PromiseState(ctx, g_promise);
    if (ps == JS_PROMISE_PENDING && ++g_ticks < PROMISE_TICKS) return;
    if (ps == JS_PROMISE_PENDING) {
        JSValue e = JS_NewError(ctx);
        JS_SetPropertyStr(ctx, e, "message", JS_NewString(ctx, "the promise did not settle"));
        answer(ctx, e, 1);
        JS_FreeValue(ctx, e);
    } else {
        JSValue r = JS_PromiseResult(ctx, g_promise);
        answer(ctx, r, ps == JS_PROMISE_REJECTED);
        JS_FreeValue(ctx, r);
    }
    JS_FreeValue(ctx, g_promise);
    g_has_promise = 0;
#else
    (void)ctx;
#endif
}

void ui_eval_stop(JSContext *ctx) {
#ifdef MOVY_TESTBUS_EVAL
    if (g_has_promise) { JS_FreeValue(ctx, g_promise); g_has_promise = 0; }
#else
    (void)ctx;
#endif
}
