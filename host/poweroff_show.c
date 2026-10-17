#include <string.h>
#include <time.h>

#include "js_display.h"
#include "lib/schwung_spi_lib.h"
#include "log.h"
#include "movy_host.h"
#include "poweroff_show.h"

#define PAD_FIRST 68
#define PADS 32
/* Notes 0-127 outside the pads, then CCs 0-127: schwung's clearAllLEDs set. */
#define CLEAR_PKTS (128 - PADS + 128)
#define CLEAR_FRAMES ((CLEAR_PKTS + MIDI_OUT_PER_FRAME - 1) / MIDI_OUT_PER_FRAME)
/* Move's palette: 1-26 is one turn of the hue wheel at full brightness. */
#define HUES 26
#define HUE_STEP 4

static void pkt(uint8_t *p, uint8_t status, uint8_t id, uint8_t val) {
    p[0] = (uint8_t)(status >> 4);   /* cable 0, CIN = the status nibble */
    p[1] = status;
    p[2] = id;
    p[3] = val;
}

uint8_t poweroff_show_pad_colour(int pad, int step) {
    if (step < 0) return 0;
    /* The whole wheel along the diagonal (11 pads corner to corner), turning
     * a seventh of it a step. One hue a step and a grid spanning ten hues sat
     * on one colour for the seconds a shutdown takes (seen on the device). */
    return (uint8_t)(((pad % 8 + pad / 8) * HUES / 11 + step * HUE_STEP) % HUES + 1);
}

int poweroff_show_leds(int frame, uint8_t out[MIDI_OUT_PER_FRAME][4]) {
    int n = 0;
    if (frame < CLEAR_FRAMES) {
        for (int i = frame * MIDI_OUT_PER_FRAME; i < CLEAR_PKTS && n < MIDI_OUT_PER_FRAME; i++) {
            if (i < 128 - PADS) { int note = i < PAD_FIRST ? i : i + PADS; pkt(out[n++], 0x90, (uint8_t)note, 0); }
            else pkt(out[n++], 0xB0, (uint8_t)(i - (128 - PADS)), 0);
        }
        return n;
    }
    /* Per step: the colour each pad already shows on channel 0 (the fade's
     * start; no visible change), then the next one on the fade channel. In
     * separate frames, so the start is set before the fade is asked for. */
    int g = frame - CLEAR_FRAMES, step = g / POWEROFF_STEP_FRAMES, phase = g % POWEROFF_STEP_FRAMES;
    int chunks = (PADS + MIDI_OUT_PER_FRAME - 1) / MIDI_OUT_PER_FRAME, fade = phase >= chunks;
    if (phase >= 2 * chunks) return 0;
    for (int p = (phase % chunks) * MIDI_OUT_PER_FRAME; p < PADS && n < MIDI_OUT_PER_FRAME; p++)
        pkt(out[n++], (uint8_t)(0x90 | (fade ? POWEROFF_FADE_CHANNEL : 0)), (uint8_t)(PAD_FIRST + p),
            poweroff_show_pad_colour(p, fade ? step : step - 1));
    return n;
}

static void draw_screen(uint8_t packed[1024]) {
    static const char *text = "Powering off...";
    js_display_clear();
    js_display_print((128 - js_display_text_width(text)) / 2, (64 - js_display_get_font_height()) / 2, text, 1);
    js_display_pack(packed);
}

void poweroff_show_tick(void *arg) {
    mh_spi_t *spi = arg;
    static int frame = -1;
    static uint64_t t0;
    static uint8_t packed[1024];
    if (spi->fd < 0) {   /* the show is over: power_hold only waits */
        struct timespec ts = { 0, 100000000L };
        nanosleep(&ts, NULL);
        return;
    }
    if (frame < 0) {
        draw_screen(packed);
        t0 = mh_now_ms();
        /* The audio thread's last block is still in the page: replayed every
         * frame, it would be a buzz for as long as the show lasts. */
        memset(spi->map + SCHWUNG_OFF_OUT_AUDIO, 0, SCHWUNG_AUDIO_FRAMES * 4);
        mh_log("power: showing the power-off screen for up to %d s", POWEROFF_SHOW_S);
    }
    frame++;
    uint8_t out[MIDI_OUT_PER_FRAME][4];
    int n = poweroff_show_leds(frame, out);
    memset(spi->map + SCHWUNG_OFF_OUT_MIDI, 0, SCHWUNG_MIDI_OUT_MAX * 4);
    memcpy(spi->map + SCHWUNG_OFF_OUT_MIDI, out, (size_t)n * 4);
    spi_pump(spi);
    /* Only this process reads the mailbox now; uncleared, events replay. */
    memset(spi->map + SCHWUNG_OFF_IN_MIDI, 0, SCHWUNG_MIDI_IN_MAX * 8);
    spi_serve_display(spi->map, packed);
    if (mh_now_ms() - t0 < (uint64_t)POWEROFF_SHOW_S * 1000u) return;

    mh_log("power: no power-down after %d s; ending the show and releasing SPI", POWEROFF_SHOW_S);
    for (int p = 0; p < PADS; p += MIDI_OUT_PER_FRAME) {
        n = 0;
        for (int i = p; i < PADS && n < MIDI_OUT_PER_FRAME; i++) pkt(out[n++], 0x90, (uint8_t)(PAD_FIRST + i), 0);
        memset(spi->map + SCHWUNG_OFF_OUT_MIDI, 0, SCHWUNG_MIDI_OUT_MAX * 4);
        memcpy(spi->map + SCHWUNG_OFF_OUT_MIDI, out, (size_t)n * 4);
        spi_pump(spi);
    }
    spi_close(spi);
}
