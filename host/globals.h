/* The host globals ui.js and the schwung shared JS it imports may call
 * (browser-test/host-globals.json, docs/standalone/inventory.md). Every name
 * in that manifest is registered by one of the globals_*.c files — natively,
 * or as a coexistence stub — and browser-test/host-globals.mjs greps these
 * sources to prove it. */
#ifndef MH_GLOBALS_H
#define MH_GLOBALS_H

#include "quickjs.h"

void globals_register(JSContext *ctx);
void globals_register_engine(JSContext *ctx, JSValue g);
void globals_register_surface(JSContext *ctx, JSValue g);
void globals_register_stubs(JSContext *ctx, JSValue g);

/* JS → C helpers shared by the globals files. */
int  js_bytes(JSContext *ctx, JSValueConst arr, uint8_t *out, int cap);   /* count or -1 */
#define MH_FN(g, name, fn, n) JS_SetPropertyStr(ctx, g, name, JS_NewCFunction(ctx, fn, name, n))

/* Loads a module's own ui.js canvas into this runtime (ui.c). */
int  ui_eval_module_file(JSContext *ctx, const char *path, int unique);

#endif
