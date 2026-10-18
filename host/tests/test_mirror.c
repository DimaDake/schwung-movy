/* mirror.c: the /mirror segments movy-host writes in place of schwung's shim,
 * and what they cost on the audio thread while nobody is watching. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "audio_live_shm.h"
#include "mirror.h"
#include "surface_live_shm.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

void mh_log(const char *fmt, ...) { (void)fmt; }

static char dir[64], feat[128];

static void *map_ro(const char *name, size_t size) {
    char p[256];
    snprintf(p, sizeof p, "%s%s", dir, name);
    int fd = open(p, O_RDONLY);
    if (fd < 0) return NULL;
    void *m = mmap(NULL, size, PROT_READ, MAP_SHARED, fd, 0);
    close(fd);
    return m == MAP_FAILED ? NULL : m;
}

/* An explicit, distinct mtime each write: the poll keys on it, and two writes
 * inside one filesystem timestamp tick would otherwise look like one. */
static void set_mirror(int on, long stamp) {
    FILE *f = fopen(feat, "w");
    fprintf(f, "{\n  \"shadow_ui_enabled\": true,\n  \"display_mirror_enabled\": %s\n}\n", on ? "true" : "false");
    fclose(f);
    struct timespec t[2] = { { stamp, 0 }, { stamp, 0 } };
    utimensat(AT_FDCWD, feat, t, 0);
}

static double ns_per_frame(const uint8_t (*out)[4], int nout, const uint8_t *in, const int16_t *lr, int frames) {
    struct timespec a, b;
    const int N = 200000;
    clock_gettime(CLOCK_MONOTONIC, &a);
    for (int i = 0; i < N; i++) {
        mirror_out(out, nout);
        mirror_in(in, 31 * 8);
        mirror_audio(lr, frames);
    }
    clock_gettime(CLOCK_MONOTONIC, &b);
    return ((b.tv_sec - a.tv_sec) * 1e9 + (b.tv_nsec - a.tv_nsec)) / N;
}

int main(void) {
    CHECK(mirror_flag_parse("{\"display_mirror_enabled\": true}"), "true");
    CHECK(mirror_flag_parse("{\"display_mirror_enabled\":\n\ttrue}"), "true after a newline");
    CHECK(!mirror_flag_parse("{\"display_mirror_enabled\": false}"), "false");
    CHECK(!mirror_flag_parse("{\"link_audio_enabled\": true}"), "absent is off, as in the shim");

    snprintf(dir, sizeof dir, "%s/mirror-XXXXXX", getenv("TMPDIR") ? getenv("TMPDIR") : "/tmp");
    if (!mkdtemp(dir)) { perror("mkdtemp"); return 1; }
    snprintf(feat, sizeof feat, "%s/features.json", dir);

    /* A segment the shim left behind: display-server holds THIS inode, so it
     * must be re-initialised in place, never replaced. */
    char surf_path[128];
    snprintf(surf_path, sizeof surf_path, "%s%s", dir, SURFACE_LIVE_SHM_NAME);
    int fd = open(surf_path, O_RDWR | O_CREAT, 0644);
    static uint8_t junk[sizeof(surface_live_shm_t)];
    memset(junk, 0x5A, sizeof junk);
    CHECK(write(fd, junk, sizeof junk) == (ssize_t)sizeof junk, "seed the stale segment");
    struct stat before, after;
    fstat(fd, &before);
    close(fd);

    mirror_init(dir, feat);   /* no features.json yet: schwung's default, off */
    stat(surf_path, &after);
    CHECK(before.st_ino == after.st_ino, "the stale segment is reused, not replaced");
    const surface_live_shm_t *s = map_ro(SURFACE_LIVE_SHM_NAME, sizeof *s);
    const audio_live_shm_t *a = map_ro(AUDIO_LIVE_SHM_NAME, sizeof *a);
    CHECK(s && a, "both segments exist");
    if (!s || !a) return 1;
    CHECK(!memcmp(s->magic, SURFACE_LIVE_MAGIC, 8) && s->note_led[70] == 0 && s->note_led_anim[70] == SURFACE_LIVE_ANIM_NONE,
          "the stale bytes are gone");
    CHECK(!memcmp(a->magic, AUDIO_LIVE_MAGIC, 7) && a->sample_rate == 44100, "audio header");

    /* LEDs: cable 0 is the surface; cable 2 is a USB-A device, not an LED. */
    uint8_t out[4][4] = {
        { 0x09, 0x90, 70, 21 },              /* pad note 70, palette 21 */
        { 0x0B, 0xB6, 85, 127 },             /* CC 85 (Play), pulsing channel 6 */
        { 0x29, 0x90, 60, 100 },             /* cable 2: ignored */
        { 0x09, 0x90, 16, 3 },               /* step 1 */
    };
    mirror_out((const uint8_t (*)[4])out, 4);
    CHECK(s->note_led[70] == 21 && s->note_led_anim[70] == 0, "pad LED");
    CHECK(s->cc_led[85] == 127 && s->cc_led_anim[85] == 6, "CC LED and its animation channel");
    CHECK(s->note_led[60] == 0, "cable 2 is not an LED");
    CHECK(s->note_led[16] == 3, "step LED");
    CHECK((s->seq & 1) == 0, "seq even after the write");

    /* Move's RGB SysEx for a pad: F0 00 21 1D 01 01 3B 00 <note> r r g g b b F7 */
    uint8_t sx[6][4] = {
        { 0x04, 0xF0, 0x00, 0x21 }, { 0x04, 0x1D, 0x01, 0x01 }, { 0x04, 0x3B, 0x00, 71 },
        { 0x04, 0x7F, 0x01, 0x00 }, { 0x04, 0x00, 0x00, 0x10 }, { 0x05, 0xF7, 0x00, 0x00 },
    };
    mirror_out((const uint8_t (*)[4])sx, 6);
    CHECK(s->rgb[0][71][3] == 1, "RGB SysEx pad colour recorded");

    /* Presses from the raw MIDI_IN (8-byte stride), and the frame counter. */
    uint8_t in[31 * 8] = { 0 };
    uint8_t press[8] = { 0x09, 0x90, 72, 99, 1, 2, 3, 4 };
    memcpy(in, press, 8);
    uint32_t f0 = s->frame;
    mirror_in(in, sizeof in);
    CHECK(s->note_down[72] == 99, "pad press");
    CHECK(s->frame == f0 + 1, "one frame per call");

    /* Sound follows the setting, re-read by the UI poll when the file changes. */
    int16_t lr[128 * 2];
    for (int i = 0; i < 256; i++) lr[i] = (int16_t)(i * 100 - 12800);
    mirror_audio(lr, 128);
    CHECK(a->write_pos == 0, "no features.json: no sound written");
    set_mirror(1, 1000000);
    mirror_poll(1);
    CHECK(!mirror_sound_on(), "the poll only looks every 64 ticks");
    mirror_poll(64);
    CHECK(mirror_sound_on(), "Mirror Display on: sound streams");
    mirror_audio(lr, 128);
    CHECK(a->write_pos == 128 && a->ring[0] == lr[0] && a->ring[255] == lr[255], "one block, unscaled");
    set_mirror(0, 1000010);
    mirror_poll(128);
    mirror_audio(lr, 128);
    CHECK(!mirror_sound_on() && a->write_pos == 128, "Mirror Display off: nothing written");

    /* Cost on the audio thread. An idle frame (no LED change, no press) is the
     * common one; the frame budget is 2902 us. Bounds are ~100x what a laptop
     * measures, so they catch a regression in kind, not jitter. */
    uint8_t idle_in[31 * 8] = { 0 };
    double off = ns_per_frame((const uint8_t (*)[4])out, 0, idle_in, lr, 128);
    set_mirror(1, 1000020);
    mirror_poll(192);
    double on = ns_per_frame((const uint8_t (*)[4])out, 0, idle_in, lr, 128);
    double busy = ns_per_frame((const uint8_t (*)[4])out, 4, in, lr, 128);
    printf("  mirror cost per frame: idle+off %.0f ns, idle+on %.0f ns, 4 LEDs+press+on %.0f ns (budget 2902000 ns)\n",
           off, on, busy);
    CHECK(off < 1000, "idle frame with the mirror off: %.0f ns", off);
    CHECK(on < 5000, "idle frame with sound on: %.0f ns", on);

    char cmd[160];
    snprintf(cmd, sizeof cmd, "rm -rf '%s'", dir);
    if (system(cmd)) {}
    printf("test_mirror: %d checks, %d failed\n", checks, fails);
    return fails ? 1 : 0;
}
