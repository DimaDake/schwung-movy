#ifndef MH_UI_JS_H
#define MH_UI_JS_H

#include <stdint.h>
#include "quickjs.h"

void ui_js_log_exception(JSContext *ctx, const char *where);
/* Calls fn([msg...]) (or fn() when msg is NULL); -1 on an exception. */
int  ui_js_call(JSContext *ctx, JSValue fn, const uint8_t *msg, int n, const char *where);
/* The global function `name`, or JS_UNDEFINED. Caller frees. */
JSValue ui_js_global_fn(JSContext *ctx, const char *name);

#endif
