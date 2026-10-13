/* Only the audio thread may live on the audio core (WP11). A thread or a
 * process started from the audio thread inherits its core-3 pin — and, for a
 * fork, its FIFO 70: osirus forks its DSP emulator from a chain load, and that
 * process then shared core 3 with movy-audio at the same priority, so it held
 * the core while the audio thread waited (~200 late transfers per 3 s with one
 * Virus playing; 0-2 once moved). Modules decide where their threads start;
 * movy-host moves the ones that landed on its core. */
#ifndef MH_PLACEMENT_H
#define MH_PLACEMENT_H

#include <stdint.h>

#define MH_AUDIO_CORE_MASK 0x8u
#define MH_OFF_AUDIO_MASK  0x7u

/* A mask that is exactly the audio core was inherited from the audio thread
 * (nothing else pins there). A thread allowed on several cores chose that,
 * and the scheduler already keeps it off a busy FIFO 70 core. */
static inline int placement_should_move(uint64_t mask, int is_audio_thread) {
    return !is_audio_thread && mask == MH_AUDIO_CORE_MASK;
}

/* UI thread, every tick; walks /proc about once a second. */
void placement_poll(void);

#endif
