/* The built-in speaker's voicing (R8). Move's MoveSpeakerEnhancer sits on its
 * master bus, so under movy-host -- which replaces Move -- the speaker played
 * uncoloured. schwung's emulation of the enhancer (src/host/speaker_eq.c, from
 * the pinned tag) runs in its place, gated as the shim gates it: Global
 * Settings -> Audio -> Spkr EQ (features.json "speaker_eq": auto|off|on), and
 * in Auto only once XMOS has REPORTED the speaker (CC 115 = 0, cable 0) and the
 * reading has held for SPEAKER_EQ_STABLE_SEC. Biased hard toward off: a
 * headphone output coloured by a stray reading is the hollow-audio bug, and a
 * speaker without the EQ is the better failure.
 *
 * jack_state is schwung's record of the last CC 115 (shim_worker.c): Move is
 * told it at the next boot, because XMOS is silent on a jack-in boot. movy-host
 * owns SPI while it runs, so it writes the file too, or a jack change made in
 * movy would be undone at the handover. It is never READ to engage the EQ, for
 * the same silence: the file can say speaker with headphones in. */
#ifndef MH_SPEAKER_H
#define MH_SPEAKER_H
#include <stdint.h>

/* Main thread, before the audio thread starts. */
void speaker_init(const char *features_path, const char *jack_state_path);
/* UI thread, every tick: re-reads the setting when its file changed, and
 * writes jack_state when the audio thread saw a new reading. */
void speaker_poll(int tick);
/* Audio thread: one raw MIDI_IN event (4 USB-MIDI bytes) from the hardware. */
void speaker_in(const uint8_t pkt[4]);
/* Audio thread: the DAC block, interleaved stereo, in place. */
void speaker_process(int16_t *lr, int frames);

/* Exposed for the tests. */
int speaker_mode_parse(const char *json);   /* SPEAKER_EQ_MODE_* */
int speaker_engaged(void);
#endif
