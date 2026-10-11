/* engine_render against a fake dsp.so (fake_dsp.c), which mixes additively
 * like movy-dsp. Path of the built fake: argv[1]. */
#include <stdio.h>
#include <string.h>

#include "lib/schwung_spi_lib.h"
#include "vtable.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

void mh_log(const char *fmt, ...) { (void)fmt; }
void mh_log_src(const char *src, const char *fmt, ...) { (void)src; (void)fmt; }

int main(int argc, char **argv) {
    if (argc < 2 || !engine_load(argv[1], ".")) { printf("test_vtable: cannot load the fake engine\n"); return 1; }
    int16_t buf[SCHWUNG_AUDIO_FRAMES * 2];
    /* What a stack buffer can hold: the last frame's output, or anything. On
     * movy-sa that played as a ~344 Hz buzz for the first 0.4 s of every launch. */
    for (int round = 0; round < 3; round++) {
        memset(buf, 0x55, sizeof buf);
        CHECK(engine_render(buf, SCHWUNG_AUDIO_FRAMES), "an engine is loaded");
        int stale = 0;
        for (int i = 0; i < SCHWUNG_AUDIO_FRAMES * 2; i++) stale += buf[i] != 1;
        CHECK(stale == 0, "the engine mixes onto silence, never onto what the buffer held (%d stale samples)", stale);
    }
    engine_unload();
    printf("test_vtable: %d checks, %d failures\n", checks, fails);
    return fails != 0;
}
