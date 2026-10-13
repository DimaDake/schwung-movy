/* vdev/spi_fake.c: the virtual device's frame clock and XMOS half. */
#define _GNU_SOURCE
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "frame_clock.h"
#include "lib/schwung_spi_lib.h"
#include "spi.h"
#include "vdev/spi_fake.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

void mh_log(const char *fmt, ...) { (void)fmt; }

static double now_s(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

/* The device's rate, not "about as fast as it can go": every timing in the
 * tier (frames(n), the tick's sampling interval) is counted in these. */
static void test_paced_at_the_frame(mh_spi_t *s) {
    const int n = 100;
    double t0 = now_s();
    for (int i = 0; i < n; i++) spi_pump(s);
    double per_us = (now_s() - t0) * 1e6 / n;
    CHECK(per_us > MH_FRAME_US * 0.97 && per_us < MH_FRAME_US * 1.10, "a pump is one frame (%.0f us, want %u)", per_us, MH_FRAME_US);
}

/* A late pump does not push every later frame back: the deadline is absolute. */
static void test_late_frame_catches_up(mh_spi_t *s) {
    spi_pump(s);
    struct timespec busy = { 0, 2 * MH_FRAME_US * 1000L };
    nanosleep(&busy, NULL);
    double t0 = now_s();
    for (int i = 0; i < 10; i++) spi_pump(s);
    double took_us = (now_s() - t0) * 1e6;
    CHECK(took_us < 9.5 * MH_FRAME_US, "the frames a late pump lost are made up (%.0f us for 10)", took_us);
}

static void test_display_slices_in_order(mh_spi_t *s) {
    uint8_t packed[1024];
    for (int i = 0; i < 1024; i++) packed[i] = (uint8_t)(i * 7);
    uint8_t seen[1024] = { 0 };
    int got = 0;
    for (int i = 0; i < 6; i++) {
        spi_pump(s);
        spi_serve_display(s->map, packed);
        uint32_t idx;
        memcpy(&idx, s->map + SCHWUNG_OFF_OUT_DISP_STAT, 4);
        int off = (int)(idx - 1) * SCHWUNG_OUT_DISP_CHUNK_LEN;
        int len = idx == 6 ? 1024 - off : SCHWUNG_OUT_DISP_CHUNK_LEN;
        if (idx >= 1 && idx <= 6) { memcpy(seen + off, s->map + SCHWUNG_OFF_OUT_DISP_DATA, (size_t)len); got |= 1 << idx; }
    }
    CHECK(got == 0x7E, "six pumps ask for all six slices (mask %#x)", got);
    CHECK(!memcmp(seen, packed, 1024), "the slices reassemble the frame");
}

/* The file IS the mailbox: another process sees the frame count and the
 * level of the block just sent, and its MIDI_IN writes reach movy-host. */
static void test_mailbox_is_shared(mh_spi_t *s) {
    int16_t *out = (int16_t *)(s->map + SCHWUNG_OFF_OUT_AUDIO);
    out[5] = -1234;
    spi_pump(s);
    FILE *f = fopen(vspi_path(), "rb");
    uint8_t page[SCHWUNG_PAGE_SIZE];
    CHECK(f && fread(page, 1, sizeof page, f) == sizeof page, "the mailbox file reads back a page");
    if (f) fclose(f);
    uint64_t frames;
    int16_t peak;
    memcpy(&frames, page + VSPI_OFF_FRAMES, 8);
    memcpy(&peak, page + VSPI_OFF_PEAK, 2);
    CHECK(frames > 100, "the frame count is visible outside (%llu)", (unsigned long long)frames);
    CHECK(peak == 1234, "the block's peak is visible outside (%d)", peak);
    f = fopen(vspi_path(), "r+b");
    static const uint8_t note[8] = { 0x09, 0x90, 0x44, 0x7F };
    fseek(f, SCHWUNG_OFF_IN_MIDI, SEEK_SET);
    fwrite(note, 1, 8, f);
    fclose(f);
    CHECK(!memcmp(s->map + SCHWUNG_OFF_IN_MIDI, note, 4), "a MIDI_IN write from outside lands in the map");
}

int main(void) {
    char path[256];
    snprintf(path, sizeof path, "%s/vspi-test-%d", getenv("TMPDIR") ? getenv("TMPDIR") : "/tmp", (int)getpid());
    setenv("MOVY_VSPI", path, 1);
    mh_spi_t s;
    CHECK(spi_open(&s) == 0, "the virtual mailbox opens");
    test_paced_at_the_frame(&s);
    test_late_frame_catches_up(&s);
    test_display_slices_in_order(&s);
    test_mailbox_is_shared(&s);
    spi_close(&s);
    unlink(path);
    printf("spi_fake: %d/%d checks passed\n", checks - fails, checks);
    return fails != 0;
}
