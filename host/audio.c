#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#include "audio.h"
#include "display.h"
#include "inject_ring.h"
#include "lib/schwung_spi_lib.h"
#include "log.h"
#include "midi_in.h"
#include "midi_out.h"
#include "midi_tap.h"
#include "movy_host.h"
#include "param_queue.h"
#include "vtable.h"

#define FADE_FRAMES ((int)(0.5 * SCHWUNG_SAMPLE_RATE / SCHWUNG_AUDIO_FRAMES))
#define SLOW_FRAME_US 10000
#define PARAMS_PER_FRAME 8

static pthread_t g_thread;
static volatile int g_stop;
static uint64_t g_frame;
static int g_tid;

uint64_t audio_frame(void) { return __atomic_load_n(&g_frame, __ATOMIC_ACQUIRE); }
int audio_tid(void) { return g_tid; }

/* Hardware, the inject ring, then the test bus: all one input (midi_in.h). */
static int gather_input(uint8_t *map, uint8_t notes[][4], int max) {
    int n = 0;
    uint64_t now = mh_now_ms();
    uint8_t *in = map + SCHWUNG_OFF_IN_MIDI, pkt[4];
    for (int i = 0; i < SCHWUNG_MIDI_IN_MAX; i++) {
        uint8_t *e = in + i * 8;
        if (!(e[0] | e[1] | e[2] | e[3])) continue;
        if (midi_in_feed(e, now) && n < max) memcpy(notes[n++], e, 4);
    }
    /* Events persist in the RX mailbox until overwritten; as its only reader
     * we clear them, or the next frame replays them (boot-select.c). */
    memset(in, 0, SCHWUNG_MIDI_IN_MAX * 8);
    for (int b = 0; b < 16 && inject_ring_pop(pkt); b++)
        if (midi_in_feed(pkt, now) && n < max) memcpy(notes[n++], pkt, 4);
    for (int b = 0; b < 64 && midi_in_inject_pop(pkt); b++)
        if (midi_in_feed(pkt, now) && n < max) memcpy(notes[n++], pkt, 4);
    return n;
}

static void *audio_main(void *arg) {
    mh_spi_t *spi = arg;
    uint8_t *map = spi->map;
    g_tid = (int)syscall(SYS_gettid);
    pthread_setname_np(pthread_self(), "movy-audio");
    /* Core 3 is the SPI core (Move's own audio thread lives there); the
     * engine's render workers keep to 0-2. */
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(3, &set);
    sched_setaffinity(0, sizeof set, &set);
    struct sched_param sp = { .sched_priority = 70 };
    int rc = pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
    mh_log("audio: tid %d, SCHED_FIFO 70 %s", g_tid, rc == 0 ? "ok" : "refused (the rt helper will retry)");

    int16_t buf[SCHWUNG_AUDIO_FRAMES * 2];
    uint8_t out[MIDI_OUT_PER_FRAME][4], notes[64][4];
    int fade = 0;
    while (!g_stop) {
        int nout = midi_out_take(out);
        memcpy(map + SCHWUNG_OFF_OUT_MIDI, out, (size_t)nout * 4);
        for (int i = 0; i < nout; i++) midi_tap_record(g_frame + 1, out[i]);
        spi_pump(spi);
        memset(map + SCHWUNG_OFF_OUT_MIDI, 0, SCHWUNG_MIDI_OUT_MAX * 4);
        __atomic_add_fetch(&g_frame, 1, __ATOMIC_RELEASE);
        uint64_t t0 = mh_now_us();

        display_serve(map);
        int nn = gather_input(map, notes, 64);
        engine_frame_begin();
        for (int i = 0; i < nn; i++) engine_on_midi(notes[i] + 1, 3);
        int served = pq_service(engine_service, NULL, PARAMS_PER_FRAME);
        int rendered = engine_render(buf, SCHWUNG_AUDIO_FRAMES);
        engine_frame_end();

        int16_t *dst = (int16_t *)(map + SCHWUNG_OFF_OUT_AUDIO);
        if (!rendered) { memset(dst, 0, sizeof buf); fade = 0; continue; }
        /* Fade in from silence: the hardware may still carry whatever the
         * previous owner left, and a full-scale first block is a click. */
        if (fade < FADE_FRAMES) {
            for (int i = 0; i < SCHWUNG_AUDIO_FRAMES * 2; i++) dst[i] = (int16_t)(buf[i] * fade / FADE_FRAMES);
            fade++;
        } else {
            memcpy(dst, buf, sizeof buf);
        }
        uint64_t work = mh_now_us() - t0;
        if (work > SLOW_FRAME_US)
            mh_log("audio: slow frame %llu: %llu us (%d notes, %d params, last %s)",
                   (unsigned long long)g_frame, (unsigned long long)work, nn, served, served ? engine_last_key() : "-");
    }
    return NULL;
}

int audio_start(mh_spi_t *spi) {
    engine_set_mapped(spi->map);
    inject_ring_open();
    return pthread_create(&g_thread, NULL, audio_main, spi);
}

void audio_stop(void) {
    g_stop = 1;
    pthread_join(g_thread, NULL);
}
