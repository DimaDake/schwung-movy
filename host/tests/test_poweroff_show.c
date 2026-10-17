/* poweroff_show.c: what the surface shows while the box powers down. */
#define _GNU_SOURCE
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "lib/schwung_spi_lib.h"
#include "poweroff_show.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

/* ── stubs: the display, the clock, SPI ─────────────────────────────────── */
static int prints, clears, print_x, closed, pumps;
static char printed[64];
static uint64_t now_ms;
void js_display_clear(void) { clears++; prints = 0; }
void js_display_print(int x, int y, const char *s, int color) { prints++; print_x = x; snprintf(printed, sizeof printed, "%s", s); }
int  js_display_text_width(const char *s) { return (int)strlen(s) * 6; }
int  js_display_get_font_height(void) { return 8; }
void js_display_pack(uint8_t *dest) { memset(dest, 0xAA, 1024); }
void mh_log(const char *fmt, ...) { (void)fmt; }
uint64_t mh_now_ms(void) { return now_ms; }
/* Every LED packet that reached the wire, in order. */
static uint8_t wire[100000][4];
static int nwire;
void spi_pump(mh_spi_t *s) {
    pumps++;
    for (int i = 0; i < SCHWUNG_MIDI_OUT_MAX; i++) {
        uint8_t *p = s->map + SCHWUNG_OFF_OUT_MIDI + i * 4;
        if (p[0] | p[1] | p[2] | p[3]) memcpy(wire[nwire++], p, 4);
    }
}
void spi_serve_display(uint8_t *map, const uint8_t packed[1024]) { (void)map; (void)packed; }
void spi_close(mh_spi_t *s) { closed++; s->fd = -1; }

static int is_pad(int note) { return note >= 68 && note <= 99; }

static void test_leds(void) {
    uint8_t out[MIDI_OUT_PER_FRAME][4];
    int note_off[128] = { 0 }, cc_off[128] = { 0 }, painted_before_clear = 0, over = 0, bad = 0;
    int f = 0, clear_done = 0;
    for (; f < 200; f++) {
        int n = poweroff_show_leds(f, out);
        if (n > MIDI_OUT_PER_FRAME) over++;
        for (int i = 0; i < n; i++) {
            uint8_t *p = out[i];
            if (p[0] != (p[1] >> 4)) bad++;   /* cable 0, CIN = status */
            if (p[1] == 0x90 && !is_pad(p[2]) && p[3] == 0) note_off[p[2]]++;
            else if (p[1] == 0xB0 && p[3] == 0) cc_off[p[2]]++;
            else if ((p[1] == 0x90 || p[1] == (0x90 | POWEROFF_FADE_CHANNEL)) && is_pad(p[2])) { if (!clear_done) painted_before_clear++; }
            else bad++;
        }
        int all = 1;
        for (int i = 0; i < 128; i++) if ((!is_pad(i) && !note_off[i]) || !cc_off[i]) all = 0;
        if (all) clear_done = 1;
    }
    CHECK(!over, "never more than one frame's worth of MIDI out");
    CHECK(!bad, "only cable-0 note-ons and CCs");
    int twice = 0, missed = 0, pad_cleared = 0;
    for (int i = 0; i < 128; i++) {
        if (is_pad(i)) { pad_cleared += note_off[i]; continue; }
        if (!note_off[i] || !cc_off[i]) missed++;
        if (note_off[i] > 1 || cc_off[i] > 1) twice++;
    }
    CHECK(!missed, "every LED but the pads goes dark (%d missed)", missed);
    CHECK(!twice, "each one once: they stay dark, nothing repaints them");
    CHECK(!pad_cleared && !painted_before_clear, "the pads are left to the animation");
}

static void test_pads_animate(void) {
    for (int p = 0; p < 32; p++) CHECK(poweroff_show_pad_colour(p, -1) == 0, "the grid fades in from black");
    for (int step = 0; step < 52; step++) {
        int hues[27] = { 0 }, nh = 0, bad = 0, still = 0;
        for (int p = 0; p < 32; p++) {
            uint8_t c = poweroff_show_pad_colour(p, step);
            if (c < 1 || c > 26) { bad++; continue; }   /* full-brightness hues only: no brightness flicker */
            if (!hues[c]++) nh++;
            int d = (poweroff_show_pad_colour(p, step + 1) - c + 26) % 26;
            if (d < 3) still++;   /* a step must read as a new colour, not a shade */
        }
        CHECK(!bad, "step %d: hues of the wheel only", step);
        CHECK(nh >= 11, "step %d: the whole wheel on the grid, %d hues", step, nh);
        CHECK(!still, "step %d: every pad moves at least 3 hues a step", step);
    }
    CHECK(POWEROFF_STEP_FRAMES * 29 / 10 >= 500, "a step lasts at least the 0.5 s fade (%d ms)", POWEROFF_STEP_FRAMES * 29 / 10);

    /* One step on the wire: each pad's current colour on channel 0, then the
     * next on the fade channel, and nothing more until the next step. */
    uint8_t out[MIDI_OUT_PER_FRAME][4];
    int base = 0;
    while (!(poweroff_show_leds(base, out) && (out[0][1] & 0xF0) == 0x90 && is_pad(out[0][2]))) base++;
    for (int step = 0; step < 3; step++) {
        int from[32], to[32], order_bad = 0, extra = 0, wrong = 0;
        for (int p = 0; p < 32; p++) from[p] = to[p] = -1;
        for (int f = base + step * POWEROFF_STEP_FRAMES; f < base + (step + 1) * POWEROFF_STEP_FRAMES; f++) {
            int n = poweroff_show_leds(f, out);
            for (int i = 0; i < n; i++) {
                int p = out[i][2] - 68;
                if (!is_pad(out[i][2])) { wrong++; continue; }
                if (out[i][1] == 0x90) { if (from[p] >= 0) extra++; if (to[p] >= 0) order_bad++; from[p] = out[i][3]; }
                else if (out[i][1] == (0x90 | POWEROFF_FADE_CHANNEL)) { if (to[p] >= 0) extra++; to[p] = out[i][3]; }
                else wrong++;
            }
        }
        int mismatch = 0;
        for (int p = 0; p < 32; p++)
            if (from[p] != poweroff_show_pad_colour(p, step - 1) || to[p] != poweroff_show_pad_colour(p, step)) mismatch++;
        CHECK(!wrong && !extra, "step %d: one start and one fade per pad, nothing else (%d wrong, %d extra)", step, wrong, extra);
        CHECK(!order_bad, "step %d: the start colour goes out before the fade", step);
        CHECK(!mismatch, "step %d: each pad fades from the colour it shows to the next (%d off)", step, mismatch);
    }
}

static void test_tick(void) {
    static uint8_t page[SCHWUNG_PAGE_SIZE];
    mh_spi_t spi = { 3, page };
    memset(page + SCHWUNG_OFF_OUT_AUDIO, 0x55, SCHWUNG_AUDIO_FRAMES * 4);
    now_ms = 1000;
    poweroff_show_tick(&spi);
    CHECK(clears == 1 && prints == 1 && !strcmp(printed, "Powering off..."), "the screen says Powering off... and nothing else (%d prints, '%s')", prints, printed);
    CHECK(print_x == (128 - 15 * 6) / 2, "centred (x %d)", print_x);
    int loud = 0;
    for (int i = 0; i < SCHWUNG_AUDIO_FRAMES * 4; i++) loud |= page[SCHWUNG_OFF_OUT_AUDIO + i];
    CHECK(!loud, "the audio thread's last block is silenced, not replayed");
    for (int i = 0; i < 500; i++) poweroff_show_tick(&spi);
    CHECK(clears == 1, "the screen is drawn once");
    CHECK(!closed && pumps == 501, "one SPI frame per tick while the show runs");
    now_ms += POWEROFF_SHOW_S * 1000u;
    int before = nwire;
    poweroff_show_tick(&spi);
    int pads_dark = 0;
    for (int i = before; i < nwire; i++) if (wire[i][1] == 0x90 && is_pad(wire[i][2]) && wire[i][3] == 0) pads_dark++;
    CHECK(closed == 1 && spi.fd < 0, "a power-down that never comes ends the show and gives SPI up");
    CHECK(pads_dark == 32, "the pads go dark first (%d)", pads_dark);
    int p0 = pumps;
    poweroff_show_tick(&spi);
    CHECK(pumps == p0 && closed == 1, "after that the hold only waits");
}

int main(void) {
    test_leds();
    test_pads_animate();
    test_tick();
    printf("movy-host power-off show tests: %d checks, %d failed\n", checks, fails);
    return fails != 0;
}
