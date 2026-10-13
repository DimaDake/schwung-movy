/* module_path.c: the pinned schwung JS is the shipped copy, whoever imports it. */
#include <stdio.h>
#include <string.h>

#include "module_path.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

#define PIN "/data/UserData/schwung/modules/tools/movy/schwung"

static const char *res(const char *base, const char *name) {
    static char out[512];
    if (mh_module_path(base, name, PIN, out, sizeof out) != 0) return "<overflow>";
    return out;
}

int main(void) {
    const char *ui = "/data/UserData/schwung/modules/tools/movy/ui.js";
    const char *r;
    r = res(ui, "/data/UserData/schwung/shared/param_pages/page_plan.mjs");
    CHECK(!strcmp(r, PIN "/shared/param_pages/page_plan.mjs"), "ui.js's device-path import is the pinned copy (%s)", r);
    r = res(ui, "/data/UserData/schwung/shadow/shadow_ui_slot_grid.mjs");
    CHECK(!strcmp(r, PIN "/shadow/shadow_ui_slot_grid.mjs"), "shadow/ is pinned too (%s)", r);
    /* schwung's shared files import EACH OTHER by device path: still pinned. */
    r = res(PIN "/shared/param_pages/render_page.mjs", "/data/UserData/schwung/shared/menu_layout.mjs");
    CHECK(!strcmp(r, PIN "/shared/menu_layout.mjs"), "a pinned file's device-path import stays pinned (%s)", r);
    r = res(PIN "/shared/param_pages/render_page.mjs", "./viz.mjs");
    CHECK(!strcmp(r, PIN "/shared/param_pages/viz.mjs"), "a relative import resolves inside the pinned tree (%s)", r);
    r = res(PIN "/shared/param_pages/render_page.mjs", "../menu_layout.mjs");
    CHECK(!strcmp(r, PIN "/shared/menu_layout.mjs"), ".. resolves inside the pinned tree (%s)", r);
    r = res(ui, "./lib/./x/../y.mjs");
    CHECK(!strcmp(r, "/data/UserData/schwung/modules/tools/movy/lib/y.mjs"), "./ and ../ collapse (%s)", r);
    /* Only what movy ships is pinned: a module's own JS, and the builtins. */
    r = res(ui, "/data/UserData/schwung/modules/sound_generators/obxd/ui.js");
    CHECK(!strcmp(r, "/data/UserData/schwung/modules/sound_generators/obxd/ui.js"), "a module's file is not pinned (%s)", r);
    r = res(ui, "std");
    CHECK(!strcmp(r, "std"), "a builtin stays a builtin (%s)", r);
    r = res(ui, "/data/UserData/schwung/sharedx/y.mjs");
    CHECK(!strcmp(r, "/data/UserData/schwung/sharedx/y.mjs"), "only the shared/ and shadow/ directories (%s)", r);
    char tiny[8];
    CHECK(mh_module_path(ui, "/data/UserData/schwung/shared/a.mjs", PIN, tiny, sizeof tiny) == -1, "a path that does not fit is refused, never cut");
    printf("module_path: %d/%d checks passed\n", checks - fails, checks);
    return fails != 0;
}
