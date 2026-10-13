/* Where an ES module import resolves (plans/2026-10-13-pin-schwung-js.md).
 *
 * QuickJS's own rule first — a relative name joins the importing module's
 * directory, anything else is taken as written — then the pin: schwung's
 * shared and shadow JS, which ui.js and the shared files themselves import by
 * device path, is read from the copy movy ships (<module dir>/schwung/, built
 * from the pinned tag by scripts/build-schwung-js.sh), never the installed
 * schwung's. There is no fallback to the installed copy: a pinned file that
 * is missing fails the import, which is what movy's own fallbacks expect. */
#ifndef MH_MODULE_PATH_H
#define MH_MODULE_PATH_H

#include <stddef.h>

#define MH_SCHWUNG_JS_PREFIX "/data/UserData/schwung/"

/* 0 ok, -1 does not fit in `cap`. `pinned_root` is "<module dir>/schwung". */
int mh_module_path(const char *base, const char *name, const char *pinned_root, char *out, size_t cap);

#endif
