/* The two surface gestures movy-host answers itself, below the UI: the power
 * button and the hard fallback exit. Fed every cable-0 packet by midi_in_feed
 * on the audio thread, so both work while the UI is wedged in a script.
 *
 * - Power button: no CC or note, only a cable-0 SysEx, F0 00 21 1D 01 01 3A
 *   <id> <val> 00 F7 in four USB-MIDI packets (cin 4,4,4,6), sent on a HOLD
 *   (schwung_shim.c, the power_sysex lookahead). Under the shim MoveOriginal
 *   owns it; here movy-host is the only reader, and hands it to the UI's
 *   onPowerButton (the shutdown dialog, src/app/leave-modal.ts).
 * - Fallback exit: Shift + volume-knob touch + jog click, shadow_ui's own
 *   escape combo. A clean close (onUnload saves) — and if the UI has not let
 *   go 2 s later, a hard exit, so a wedged script can never trap the box. */
#ifndef MH_SURFACE_KEYS_H
#define MH_SURFACE_KEYS_H

#include <stdint.h>

#define FALLBACK_GRACE_MS 2000

/* Audio thread: one cable-0 packet. */
void surface_keys_feed(const uint8_t pkt[4], uint64_t now_ms);

/* UI thread: power-button holds since the last call. */
int surface_power_take(void);

/* When the fallback combo fired (0 = never). */
uint64_t surface_fallback_at(void);

void surface_keys_reset(void);   /* tests */

#endif
