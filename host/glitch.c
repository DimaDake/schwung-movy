#include <stdio.h>

#include "glitch.h"

int glitch_format(char *out, int cap, const glitch_t *g) {
    int n = snprintf(out, (size_t)cap,
                     "audio: glitch frame %llu: work %u us of %u (io %u, params %u [%d, slowest %s %u us], "
                     "render %u, post %u; %d notes) late_total %u",
                     (unsigned long long)g->frame, g->work_us, GLITCH_WORK_US, g->io_us, g->params_us, g->params,
                     g->params && g->slow_key && g->slow_key[0] ? g->slow_key : "-", g->slow_us, g->render_us,
                     /* After the render: status publish, mirror, the output copy. Derived so the
                      * four parts always add up to the work, and an unexplained frame cannot hide. */
                     g->work_us - g->io_us - g->params_us - g->render_us, g->notes, g->late_total);
    if (n >= 0 && n < cap && g->unlogged)
        n += snprintf(out + n, (size_t)(cap - n), " (+%d unlogged)", g->unlogged);
    if (n >= 0 && n < cap)
        n += snprintf(out + n, (size_t)(cap - n), " | engine %s", g->engine && g->engine[0] ? g->engine : "-");
    return n < cap ? n : cap - 1;
}
