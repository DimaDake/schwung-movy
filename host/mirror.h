/* The rest of schwung's web mirror (/mirror on the manager): the device under
 * the screen and the sound. Under Move, schwung's shim writes these two
 * segments (surface_live_shm.h, audio_live_shm.h); under movy nothing did, so
 * the page drew the OLED over a device frozen at whatever Move last lit, and
 * every recording was silent. movy-host writes them at the same points the
 * shim reads: LEDs from the final MIDI_OUT, presses from the raw MIDI_IN, and
 * the sound from the block that goes to the DAC.
 *
 * Cost when nobody watches: the surface is always tracked, as the shim does,
 * because an LED is written once and a viewer who arrives later must still see
 * it -- an idle frame is a scan of empty slots and one store. The sound is a
 * STREAM, so it is written only while schwung's Mirror Display setting
 * (features.json display_mirror_enabled) is on: off, it is one load and a
 * branch. host/tests/test_mirror.c measures both. */
#ifndef MH_MIRROR_H
#define MH_MIRROR_H

#include <stdint.h>

/* Main thread, before the audio thread starts. shm_dir is /dev/shm on the box. */
void mirror_init(const char *shm_dir, const char *features_path);
/* UI thread, every tick: re-reads the setting when its file changed. */
void mirror_poll(int tick);
/* Audio thread, once per frame each. */
void mirror_out(const uint8_t (*pkts)[4], int n);
void mirror_in(const uint8_t *midi_in, int bytes);
void mirror_audio(const int16_t *lr, int frames);
/* Audio thread, from the param service: the engine's `mfx:vol`, which the
 * stream undoes so it plays at unity like the shim's. */
void mirror_master_volume(const char *val);

/* Exposed for the tests. */
int mirror_flag_parse(const char *json);
int mirror_sound_on(void);

#endif
