/* Surface output: the LED queue shadow_ui puts in front of an overtake module
 * (activateLedQueue) plus the shim's MIDI_OUT drain, in one place.
 *
 * Cable-0 note-on and CC packets are LEDs: the last write per note/CC wins and
 * keeps its channel, so a colour and a channel-coded animation (movy's
 * cachedSetAnimLED) never interleave into a third state. Anything else (SysEx)
 * is a FIFO and is never coalesced. The audio thread takes at most
 * MIDI_OUT_PER_FRAME packets a frame — the 80-byte MIDI_OUT region. */
#ifndef MH_MIDI_OUT_H
#define MH_MIDI_OUT_H

#include <stdint.h>

#define MIDI_OUT_PER_FRAME 20

/* UI thread: move_midi_internal_send / move_midi_external_send. len is a
 * multiple of 4 bytes; the cable nibble is overwritten. 0 = refused (full). */
int  midi_out_send(int cable, const uint8_t *pkts, int len);
/* Audio thread (the engine's midi_send_external). 0 = full. */
int  midi_out_send_audio(const uint8_t pkt[4]);
/* Audio thread: the packets for this frame, at most MIDI_OUT_PER_FRAME. */
int  midi_out_take(uint8_t out[MIDI_OUT_PER_FRAME][4]);
/* The last colour actually sent to each pad (notes 68-99): what is lit. */
void midi_out_pad_snapshot(uint8_t out[32]);
void midi_out_reset(void);

#endif
