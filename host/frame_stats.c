/* The audio thread's frame statistics (frame_stats.h). Written by the audio
 * thread only; each window is published whole, so a reader never sees half of
 * one. */
#include <stdint.h>

#include "frame_clock.h"
#include "frame_stats.h"

#define WORK_WINDOW 1024
static uint32_t g_work_avg_us, g_work_max_us, g_pump_min_us, g_gap_max_us, g_late;
static uint64_t g_win_sum, g_win_max, g_win_pump_min = UINT64_MAX, g_win_gap_max, g_last;
static int g_win_n;

void frame_stats_transfer(uint64_t before_us, uint64_t after_us) {
    if (frame_late(g_last, after_us)) __atomic_add_fetch(&g_late, 1, __ATOMIC_RELAXED);
    uint64_t pump = after_us - before_us, gap = g_last ? after_us - g_last : MH_FRAME_US;
    g_last = after_us;
    if (pump < g_win_pump_min) g_win_pump_min = pump;
    if (gap > g_win_gap_max) g_win_gap_max = gap;
}

void frame_stats_work(uint64_t us) {
    g_win_sum += us;
    if (us > g_win_max) g_win_max = us;
    if (++g_win_n < WORK_WINDOW) return;
    __atomic_store_n(&g_work_avg_us, (uint32_t)(g_win_sum / WORK_WINDOW), __ATOMIC_RELAXED);
    __atomic_store_n(&g_work_max_us, (uint32_t)g_win_max, __ATOMIC_RELAXED);
    __atomic_store_n(&g_pump_min_us, (uint32_t)g_win_pump_min, __ATOMIC_RELAXED);
    __atomic_store_n(&g_gap_max_us, (uint32_t)g_win_gap_max, __ATOMIC_RELAXED);
    g_win_sum = g_win_max = g_win_gap_max = 0;
    g_win_pump_min = UINT64_MAX;
    g_win_n = 0;
}

void audio_work_us(uint32_t *avg, uint32_t *max) {
    *avg = __atomic_load_n(&g_work_avg_us, __ATOMIC_RELAXED);
    *max = __atomic_load_n(&g_work_max_us, __ATOMIC_RELAXED);
}

void audio_pump_us(uint32_t *pump_min, uint32_t *gap_max) {
    *pump_min = __atomic_load_n(&g_pump_min_us, __ATOMIC_RELAXED);
    *gap_max = __atomic_load_n(&g_gap_max_us, __ATOMIC_RELAXED);
}

uint32_t audio_late_frames(void) { return __atomic_load_n(&g_late, __ATOMIC_RELAXED); }
