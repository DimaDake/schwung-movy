/* UI_EVAL (docs/standalone/testbus.md): JS run on the UI thread between two
 * ticks, for the harness to read the ViewModel directly. Compiled in only
 * with MOVY_TESTBUS_EVAL (dev builds); the bus answers ERR otherwise. */
#ifndef MH_UI_EVAL_H
#define MH_UI_EVAL_H

#include "quickjs.h"

/* Bus thread: blocks until the UI answered or timeout_ms passed. Writes
 * `OK <json>` or `ERR UI_EVAL: …` into out. */
void ui_eval_request(const char *src, char *out, int cap, int timeout_ms);

/* UI thread, once per tick: starts a waiting request, or settles a promise
 * one returned. Never blocks. */
void ui_eval_service(JSContext *ctx);

/* UI thread, before the context is freed: a promise still held would trip
 * QuickJS's leak assertion at JS_FreeRuntime. */
void ui_eval_stop(JSContext *ctx);

#endif
