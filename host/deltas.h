/* Encoder batching, exactly as shadow_ui does it for an overtake module:
 * knob (CC 71-78) and jog (CC 14) turns are summed between ticks and handed
 * over as ONE synthetic CC per encoder per tick, CW = count (1-63),
 * CCW = 128 - |count| (65-127). movy decodes them with decodeDelta, and its
 * knob feel (acceleration, detent maths) was tuned against this batching. */
#ifndef MH_DELTAS_H
#define MH_DELTAS_H

#include <stdint.h>

#define DELTAS_KNOB_CC 71
#define DELTAS_JOG_CC 14

typedef struct { int knob[8]; int jog; } deltas_t;

int  delta_decode(int v);
int  delta_encode(int d);
/* 1 when msg was an encoder turn and has been absorbed (do not forward it). */
int  deltas_absorb(deltas_t *d, const uint8_t msg[3]);
/* Writes up to 9 CC messages, knobs in order then jog; returns the count. */
int  deltas_flush(deltas_t *d, uint8_t out[9][3]);

#endif
