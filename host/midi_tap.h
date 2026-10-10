/* The test bus's `midi_out` channel: every packet movy-host puts on the wire,
 * with the frame it left on (docs/standalone/testbus.md, SUBSCRIBE / DUMP). */
#ifndef MH_MIDI_TAP_H
#define MH_MIDI_TAP_H

#include <stdint.h>

#include "testbus.h"

#define MIDI_TAP_CAP 4096u   /* power of two */

/* Audio thread, per packet sent; free when nobody subscribed. */
void midi_tap_record(uint64_t frame, const uint8_t pkt[4]);

/* Bus thread. Subscribing again resets the baseline. */
void midi_tap_subscribe(void);
void midi_tap_unsubscribe(void);
/* `OK count=N dropped=D`, `EV <frame_hex8> <pkt_hex8>` ×N, `END`: everything
 * since the last DUMP (or subscribe). More than the ring holds drops the
 * OLDEST and counts them, as schwung-testd does. */
int midi_tap_dump(tb_reply_t *o);

#endif
