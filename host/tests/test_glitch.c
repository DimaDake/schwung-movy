/* glitch.c: the over-budget line names every stage and the engine's account. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "glitch.h"
#include "glitch_log.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

int main(void) {
    char line[768];
    CHECK(!glitch_over(GLITCH_WORK_US) && glitch_over(GLITCH_WORK_US + 1), "the budget is the frame less the DMA");
    CHECK(GLITCH_WORK_US < MH_FRAME_US, "a frame cannot afford a whole frame of work");

    glitch_t g = { 87453, 16217, 40, 12, 16150, 0, 1, "ch0:lfo1:sync", 25, 9, "seq=1 load=15900 top=3:obxd:200", 0 };
    glitch_format(line, sizeof line, &g);
    CHECK(strstr(line, "glitch frame 87453: work 16217 us") != NULL, "%s", line);
    CHECK(strstr(line, "slowest ch0:lfo1:sync 25 us") != NULL, "%s", line);
    CHECK(strstr(line, "render 16150, post 15;") != NULL && strstr(line, "late_total 9") != NULL, "%s", line);
    CHECK(strstr(line, "| engine seq=1 load=15900 top=3:obxd:200") != NULL, "%s", line);
    CHECK(strstr(line, "unlogged") == NULL, "nothing dropped, nothing said: %s", line);

    g.params = 0; g.engine = NULL; g.unlogged = 4;
    glitch_format(line, sizeof line, &g);
    CHECK(strstr(line, "slowest - ") != NULL, "no params serviced names none: %s", line);
    CHECK(strstr(line, "(+4 unlogged) | engine -") != NULL, "%s", line);

    char tiny[24];
    int n = glitch_format(tiny, sizeof tiny, &g);
    CHECK(n == (int)strlen(tiny) && n < (int)sizeof tiny, "a short buffer truncates, never overruns (%d)", n);

    /* glitch_log.c: the weeks-long file keeps only what a ranking needs. */
    CHECK(glitch_log_keeps("audio: glitch frame 1: work 3000 us") && glitch_log_keeps("audio: late transfer 2 with"),
          "the recorder's lines are kept");
    CHECK(glitch_log_keeps("=== movy-host 0.9 schwung=v1.7.3") && glitch_log_keeps("[movy] seq: loaded set abc")
          && glitch_log_keeps("[movy] page ready ck=lfo ms=40"), "launch, set load and page open give the context");
    CHECK(!glitch_log_keeps("[movy] perf_ipc calls/tick=0.5") && !glitch_log_keeps("audio: tid 1") && !glitch_log_keeps(NULL),
          "the rest of the log is not");

    char path[256], rot[260], buf[512];
    snprintf(path, sizeof path, "%s/movy-glitch-test-%d.log", getenv("TMPDIR") ? getenv("TMPDIR") : "/tmp", (int)getpid());
    snprintf(rot, sizeof rot, "%s.1", path);
    unlink(path); unlink(rot);
    glitch_log_t gl = { path, 200, -1, 0 };
    int64_t ms = (int64_t)mktime(&(struct tm){ .tm_year = 126, .tm_mon = 9, .tm_mday = 31, .tm_hour = 9, .tm_min = 5, .tm_sec = 7, .tm_isdst = -1 }) * 1000 + 42;
    glitch_log_write(&gl, ms, "audio: glitch frame 7: work 2600 us");
    glitch_log_write(&gl, ms, "[movy] perf_ipc dropped");
    glitch_log_close(&gl);
    FILE *f = fopen(path, "r");
    size_t got = f ? fread(buf, 1, sizeof buf - 1, f) : 0;
    if (f) fclose(f);
    buf[got] = '\0';
    CHECK(!strcmp(buf, "2026-10-31 09:05:07.042 audio: glitch frame 7: work 2600 us\n"), "dated, one line: [%s]", buf);

    for (int i = 0; i < 6; i++) glitch_log_write(&gl, ms, "audio: late transfer 9 with no over-budget work before it");
    glitch_log_close(&gl);
    struct stat st;
    CHECK(stat(rot, &st) == 0 && stat(path, &st) == 0 && st.st_size < 200 + 100, "past the cap it rotates once, bounded");
    unlink(path); unlink(rot);

    printf("glitch: %d/%d checks passed\n", checks - fails, checks);
    return fails != 0;
}
