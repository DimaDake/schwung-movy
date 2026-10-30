/* glitch.c: the over-budget line names every stage and the engine's account. */
#include <stdio.h>
#include <string.h>

#include "glitch.h"

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

    printf("glitch: %d/%d checks passed\n", checks - fails, checks);
    return fails != 0;
}
