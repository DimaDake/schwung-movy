/* The glitch recorder: one line in the log for every audio frame whose work ran
 * past what the frame can afford, saying where the time went — movy-host's own
 * stages, then the engine's (`blockprof`, engine/crates/movy-dsp/src/
 * block_prof.rs) down to the three costliest chains by module. A click heard on
 * the box can then be matched to a stage or a module afterwards, which the CPU
 * page's means and held peaks cannot do. The old slow-frame line only fired
 * past 10 ms, 3.4 frames, so every click short of that went unrecorded.
 *
 * And a late transfer that NO over-budget frame explains gets its own line:
 * that is a click from outside the audio thread's work (the SPI wait, the
 * kernel), which no amount of module profiling would find. */
#ifndef MH_GLITCH_H
#define MH_GLITCH_H

#include <stdint.h>

#include "frame_clock.h"

/* The transfer's DMA is ~400 us of the frame (testbus.md, pump_min_us), so
 * work past the rest makes the next transfer late: audio the converter does
 * not get in time. */
#define GLITCH_WORK_US (MH_FRAME_US - 400u)
#define GLITCH_LINES_PER_S 20

typedef struct {
    uint64_t frame;
    uint32_t work_us, io_us, params_us, render_us;
    int notes, params;
    const char *slow_key;   /* the frame's slowest param request */
    uint32_t slow_us;
    uint32_t late_total;
    const char *engine;     /* the engine's blockprof, or NULL when not read */
    int unlogged;           /* over-budget frames the rate limit dropped since the last line */
} glitch_t;

static inline int glitch_over(uint64_t work_us) { return work_us > GLITCH_WORK_US; }

/* The log line, without the logger's prefix. Returns its length. */
int glitch_format(char *out, int cap, const glitch_t *g);

#endif
