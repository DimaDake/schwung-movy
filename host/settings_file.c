#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "settings_file.h"

void features_open(features_file_t *f, const char *path) {
    snprintf(f->path, sizeof f->path, "%s", path);
    f->mtime = (struct timespec){ 0, 0 };
    f->read_once = 0;
}

int features_read_if_changed(features_file_t *f, char *buf, size_t cap) {
    struct stat st;
    struct timespec m = { 0, 0 };   /* absent keeps the zero stamp */
    int present = stat(f->path, &st) == 0;
    if (present) {
#ifdef __APPLE__
        m = st.st_mtimespec;
#else
        m = st.st_mtim;
#endif
    }
    if (f->read_once && m.tv_sec == f->mtime.tv_sec && m.tv_nsec == f->mtime.tv_nsec) return 0;
    f->read_once = 1;
    f->mtime = m;
    FILE *fp = present ? fopen(f->path, "r") : NULL;
    size_t n = fp ? fread(buf, 1, cap - 1, fp) : 0;
    if (fp) fclose(fp);
    buf[n] = '\0';
    return 1;
}

const char *features_value(const char *json, const char *key) {
    char quoted[64];
    snprintf(quoted, sizeof quoted, "\"%s\"", key);
    const char *k = strstr(json, quoted);
    const char *c = k ? strchr(k + strlen(quoted), ':') : NULL;
    if (!c) return NULL;
    for (c++; *c == ' ' || *c == '\t' || *c == '\n' || *c == '\r'; c++) {}
    return c;
}
