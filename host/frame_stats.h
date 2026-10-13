/* Frame headroom (WP7 T6, WP11): the audio thread's own work per frame —
 * input, engine notes, params, render, output — and the SPI transfer around
 * it, over windows of 1024 frames against the 2902 us budget. */
#ifndef MH_FRAME_STATS_H
#define MH_FRAME_STATS_H

#include <stdint.h>

/* Audio thread: around each SPI transfer, then the frame's work after it. */
void frame_stats_transfer(uint64_t before_us, uint64_t after_us);
void frame_stats_work(uint64_t us);

/* The work per frame, avg and max over the last window (us). */
void audio_work_us(uint32_t *avg, uint32_t *max);
/* Over the same window: the shortest SPI transfer call (boundary wait + ~400
 * us DMA; near 400 means no slack left) and the longest transfer-to-transfer
 * gap (us). */
void audio_pump_us(uint32_t *pump_min, uint32_t *gap_max);
/* Transfers that ran late since start (frame_clock.h). */
uint32_t audio_late_frames(void);

#endif
