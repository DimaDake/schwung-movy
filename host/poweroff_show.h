/* What the surface shows while the box powers down: "Powering off..." alone
 * on the screen, a rainbow moving over the pads, every other LED dark.
 *
 * Runs in main's power hold, after the audio thread and the engine are gone,
 * so it drives SPI itself. Without it the hold sat for the seconds a shutdown
 * takes with a blank screen and the last UI's LEDs frozen on, which read as a
 * hang. */
#ifndef MH_POWEROFF_SHOW_H
#define MH_POWEROFF_SHOW_H

#include <stdint.h>
#include "midi_out.h"
#include "spi.h"

/* SPI frames per colour step (~2.9 ms each): ~0.7 s. Each step is a hardware
 * crossfade, not a repaint: the pad's note-on on MIDI channel 4 (Trans4th,
 * schwung constants.mjs) fades from its channel-0 colour to the new one in a
 * quarter note, 0.5 s at the firmware's 120 BPM, so the fade ends before the
 * next step re-arms it. Repainting faster than that flashed the whole grid. */
#define POWEROFF_STEP_FRAMES 240
#define POWEROFF_FADE_CHANNEL 0x04
/* The show gives SPI up after this: the shutdown is seconds, and a power-down
 * that never comes must not keep the device from whoever asks for it next. */
#define POWEROFF_SHOW_S 30

/* The LED packets (cable 0) for SPI frame `frame` of the show, at most
 * MIDI_OUT_PER_FRAME: first every non-pad note and CC to 0, then the pads. */
int poweroff_show_leds(int frame, uint8_t out[MIDI_OUT_PER_FRAME][4]);
/* The Move palette index pad `pad` (0 = note 68, bottom left) fades to at
 * step `step`; step -1 is black, so the grid fades in. */
uint8_t poweroff_show_pad_colour(int pad, int step);
/* power_hold's tick: one SPI frame of the show, until POWEROFF_SHOW_S, then
 * the pads dark and SPI released. `arg` is the open mh_spi_t. */
void poweroff_show_tick(void *arg);

#endif
