/* The movy-audio thread: one SPI frame per 128-sample block (~2.9 ms). */
#ifndef MH_AUDIO_H
#define MH_AUDIO_H

#include <stdint.h>
#include "spi.h"

int  audio_start(mh_spi_t *spi);
void audio_stop(void);
uint64_t audio_frame(void);
int  audio_tid(void);

/* The audio thread's work per frame, avg and max over the last window (us). */
void audio_work_us(uint32_t *avg, uint32_t *max);

#endif
