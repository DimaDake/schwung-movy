/* A late frame: the audio thread reached the SPI transfer after the frame
 * boundary. The hardware does not skip a frame when that happens; the
 * transfer simply runs late, so an overrun shows as a gap longer than a frame
 * and a block rate under 344.5 Hz (measured WP11: serial render at 2963 us of
 * work ran at 293.7 Hz, gaps to 3644 us, and never once a two-frame gap).
 * Every late transfer is audio the converter did not get in time. On-time
 * jitter measured at most 49 us, so 1/16 of a frame (181 us) is the line. */
#ifndef MH_FRAME_CLOCK_H
#define MH_FRAME_CLOCK_H

#include <stdint.h>

#define MH_FRAME_US 2902u

static inline int frame_late(uint64_t prev_us, uint64_t now_us) {
    return prev_us && now_us - prev_us > MH_FRAME_US + MH_FRAME_US / 16;
}

#endif
