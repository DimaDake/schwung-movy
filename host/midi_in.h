/* Surface input: what the shim + shadow_ui did between the SPI mailbox and an
 * overtake module, reduced to the part movy relies on.
 *
 * Every packet reaches the UI (onMidiMessageInternal / External); a cable-0
 * note with d1 >= 10 (pads, steps — not knob touches) ALSO goes straight to
 * the engine's on_midi on the audio thread, which is the shim's pad path
 * (schwung_shim.c, "Deliver internal cable-0 note events"). Hardware, the
 * test bus and the schwung-midi-inject ring all enter through midi_in_feed,
 * so an injected press is indistinguishable from a real one — the overtake
 * two-ring split does not exist here. */
#ifndef MH_MIDI_IN_H
#define MH_MIDI_IN_H

#include <stdint.h>

/* Audio thread. Returns 1 when the packet is also an engine note. */
int  midi_in_feed(const uint8_t pkt[4], uint64_t now_ms);
/* UI thread. */
int  midi_in_ui_pop(uint8_t pkt[4]);
uint32_t midi_in_ui_dropped(void);

/* The held-step / delete state schwung's page_controller reads through
 * shadow_get_held_step & co. Same meaning as the shim's bytes. */
int  midi_in_held_step(void);
int  midi_in_held_step_is_hold(uint64_t now_ms);
int  midi_in_delete_held(void);

/* The test bus's INJECT_MIDI queue (testbus thread → audio thread). */
#define MIDI_IN_INJECT_CAP 256u
int  midi_in_inject_push(const uint8_t pkt[4]);   /* 0 = full */
int  midi_in_inject_pop(uint8_t pkt[4]);
uint32_t midi_in_inject_queued(void);

void midi_in_reset(void);   /* tests */

#endif
