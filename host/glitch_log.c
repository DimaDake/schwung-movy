#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "glitch_log.h"

int glitch_log_keeps(const char *text) {
    if (!text) return 0;
    /* The UI's lines arrive through console.log as "[movy] ..." (src/log.ts). */
    if (!strncmp(text, "[movy] ", 7)) text += 7;
    return !strncmp(text, "audio: glitch frame", 19) || !strncmp(text, "audio: late transfer", 20)
        || !strncmp(text, "=== movy-host ", 14) || !strncmp(text, "seq: loaded set ", 16)
        || !strncmp(text, "page ready ck=", 14);
}

static int open_log(glitch_log_t *g) {
    g->fd = open(g->path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
    if (g->fd < 0) return -1;
    struct stat st;
    g->size = fstat(g->fd, &st) == 0 ? (uint64_t)st.st_size : 0;
    return 0;
}

static void rotate(glitch_log_t *g) {
    char old[512];
    snprintf(old, sizeof old, "%s.1", g->path);
    close(g->fd);
    g->fd = -1;
    rename(g->path, old);
    open_log(g);
}

void glitch_log_write(glitch_log_t *g, int64_t ms, const char *text) {
    if (!g || !g->path || !glitch_log_keeps(text)) return;
    if (g->fd < 0 && open_log(g) < 0) return;
    if (g->size >= (g->cap ? g->cap : GLITCH_LOG_CAP)) rotate(g);
    if (g->fd < 0) return;

    time_t s = (time_t)(ms / 1000);
    struct tm tm;
    localtime_r(&s, &tm);
    char line[1200];
    int n = (int)strftime(line, sizeof line, "%Y-%m-%d %H:%M:%S", &tm);
    n += snprintf(line + n, sizeof line - (size_t)n, ".%03d %s\n", (int)(ms % 1000), text);
    if (n >= (int)sizeof line) { n = (int)sizeof line - 1; line[n - 1] = '\n'; }
    if (write(g->fd, line, (size_t)n) == n) g->size += (uint64_t)n;
}

void glitch_log_close(glitch_log_t *g) {
    if (g && g->fd >= 0) { close(g->fd); g->fd = -1; }
}
