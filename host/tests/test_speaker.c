/* speaker.c: when movy-host voices the built-in speaker, and what it costs the
 * audio thread. The filter itself is schwung's (tests/host/test_speaker_eq.c
 * upstream); this pins the gate movy wraps around it. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "shadow_constants.h"
#include "speaker.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

void mh_log(const char *fmt, ...) { (void)fmt; }

static char dir[64], feat[128], jack[128];

static void set_mode(const char *mode, long stamp) {
    FILE *f = fopen(feat, "w");
    fprintf(f, "{\n  \"speaker_eq_mode\": \"on\",\n  \"speaker_eq\": \"%s\"\n}\n", mode);
    fclose(f);
    struct timespec t[2] = { { stamp, 0 }, { stamp, 0 } };
    utimensat(AT_FDCWD, feat, t, 0);
}

static int16_t blk[128 * 2];
static void fill(void) { for (int i = 0; i < 256; i++) blk[i] = (int16_t)((i * 7919) % 16000 - 8000); }
/* 1 when the block came back unchanged: the EQ did not run. */
static int untouched(void) {
    int16_t ref[256];
    fill();
    memcpy(ref, blk, sizeof ref);
    speaker_process(blk, 128);
    return memcmp(ref, blk, sizeof ref) == 0;
}

static void report(uint8_t cable, uint8_t value) {
    uint8_t pkt[4] = { (uint8_t)(cable << 4 | 0x0B), 0xB0, 115, value };
    speaker_in(pkt);
}

static int read_jack_state(void) {
    FILE *f = fopen(jack, "r");
    int v = -1;
    if (f) { if (fscanf(f, "%d", &v) != 1) v = -2; fclose(f); }
    return v;
}

int main(void) {
    CHECK(speaker_mode_parse("{}") == SPEAKER_EQ_MODE_AUTO, "absent: auto, schwung's default");
    CHECK(speaker_mode_parse("{\"speaker_eq\": \"off\"}") == SPEAKER_EQ_MODE_OFF, "off");
    CHECK(speaker_mode_parse("{\"speaker_eq\":\"on\"}") == SPEAKER_EQ_MODE_ON, "on");
    CHECK(speaker_mode_parse("{\"speaker_eq\": \"auto\"}") == SPEAKER_EQ_MODE_AUTO, "auto");
    CHECK(speaker_mode_parse("{\"speaker_eq_mode\": \"on\"}") == SPEAKER_EQ_MODE_AUTO,
          "the removed toggle's stale key is not honoured, as in the shim");

    snprintf(dir, sizeof dir, "%s/speaker-XXXXXX", getenv("TMPDIR") ? getenv("TMPDIR") : "/tmp");
    if (!mkdtemp(dir)) { perror("mkdtemp"); return 1; }
    snprintf(feat, sizeof feat, "%s/features.json", dir);
    snprintf(jack, sizeof jack, "%s/jack_state", dir);
    /* A stale "speaker" on disk must not engage it: XMOS is silent on a
     * jack-in boot, so the file can say speaker with headphones in. */
    FILE *f = fopen(jack, "w");
    fprintf(f, "0\n");
    fclose(f);

    speaker_init(feat, jack);   /* no features.json: auto */
    CHECK(untouched() && !speaker_engaged(), "auto with no jack report: bypassed, whatever jack_state says");
    report(2, 0);
    CHECK(untouched(), "a CC 115 on cable 2 is a USB-A device, not the jack");
    report(0, 0);
    CHECK(untouched(), "a fresh speaker reading is not trusted yet");
    speaker_poll(1);
    CHECK(read_jack_state() == 0, "the reading is recorded for schwung's next boot");
    report(0, 127);
    speaker_poll(2);
    CHECK(read_jack_state() == 127, "a cable is recorded too");
    report(0, 0);
    struct timespec held = { 3, 100000000L };   /* SPEAKER_EQ_STABLE_SEC */
    nanosleep(&held, NULL);
    CHECK(!untouched() && speaker_engaged(), "a speaker reading held 3 s: engaged");
    report(2, 127);
    CHECK(!untouched(), "a USB-A device's CC 115 does not bypass it");
    set_mode("off", 1000000);
    speaker_poll(64);
    CHECK(untouched() && !speaker_engaged(), "Spkr EQ Off: bypassed on a trusted speaker");
    set_mode("auto", 1000010);
    speaker_poll(128);
    CHECK(!untouched(), "back to Auto: engaged again");
    report(0, 127);
    CHECK(untouched() && !speaker_engaged(), "headphones in: bypassed at once");
    set_mode("on", 1000020);
    speaker_poll(192);
    CHECK(!untouched(), "Spkr EQ On engages whatever the jack says");

    /* Cost on the audio thread, still On from above (the worst case); the frame budget is
     * 2902 us. The bound is ~100x what a laptop measures. */
    struct timespec a, b;
    const int N = 20000;
    clock_gettime(CLOCK_MONOTONIC, &a);
    for (int i = 0; i < N; i++) speaker_process(blk, 128);
    clock_gettime(CLOCK_MONOTONIC, &b);
    double ns = ((b.tv_sec - a.tv_sec) * 1e9 + (b.tv_nsec - a.tv_nsec)) / N;
    printf("  speaker eq cost per block: %.0f ns engaged (budget 2902000 ns)\n", ns);
    CHECK(ns < 200000, "engaged block: %.0f ns", ns);

    char cmd[160];
    snprintf(cmd, sizeof cmd, "rm -rf '%s'", dir);
    if (system(cmd)) {}
    printf("test_speaker: %d checks, %d failed\n", checks, fails);
    return fails ? 1 : 0;
}
