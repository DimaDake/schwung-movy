#include <stdio.h>
#include <string.h>

#include "module_path.h"

/* "/a/b/../c/./d" → "/a/c/d", in place. */
static void collapse(char *p) {
    char *segs[128];
    int n = 0;
    char *save = NULL;
    char buf[1024];
    snprintf(buf, sizeof buf, "%s", p);
    for (char *s = strtok_r(buf, "/", &save); s && n < 128; s = strtok_r(NULL, "/", &save)) {
        if (!strcmp(s, ".")) continue;
        if (!strcmp(s, "..")) { if (n) n--; continue; }
        segs[n++] = s;
    }
    char *w = p;
    int abs = p[0] == '/';
    *w = '\0';
    for (int i = 0; i < n; i++) {
        if (i || abs) *w++ = '/';
        size_t l = strlen(segs[i]);
        memcpy(w, segs[i], l);
        w += l;
    }
    *w = '\0';
}

static int pinned(const char *path) {
    static const char *dirs[] = { MH_SCHWUNG_JS_PREFIX "shared/", MH_SCHWUNG_JS_PREFIX "shadow/" };
    for (size_t i = 0; i < sizeof dirs / sizeof *dirs; i++)
        if (!strncmp(path, dirs[i], strlen(dirs[i]))) return 1;
    return 0;
}

int mh_module_path(const char *base, const char *name, const char *pinned_root, char *out, size_t cap) {
    char path[1024];
    if (name[0] == '.') {
        const char *slash = base ? strrchr(base, '/') : NULL;
        int dlen = slash ? (int)(slash - base) : 0;
        if ((size_t)snprintf(path, sizeof path, "%.*s/%s", dlen, base ? base : "", name) >= sizeof path) return -1;
        collapse(path);
    } else if ((size_t)snprintf(path, sizeof path, "%s", name) >= sizeof path) {
        return -1;
    }
    if (pinned(path)) {
        const char *rest = path + strlen(MH_SCHWUNG_JS_PREFIX);
        return (size_t)snprintf(out, cap, "%s/%s", pinned_root, rest) >= cap ? -1 : 0;
    }
    return (size_t)snprintf(out, cap, "%s", path) >= cap ? -1 : 0;
}
