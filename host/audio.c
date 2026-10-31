#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <string.h>
#include <time.h>
#include <sys/syscall.h>
#include <unistd.h>

#include "audio.h"
#include "display.h"
#include "frame_stats.h"
#include "glitch.h"
#include "handover.h"
#include "inject_ring.h"
#include "ui_ring.h"
#include "lib/schwung_spi_lib.h"
#include "log.h"
#include "log_ring.h"
#include "midi_in.h"
#include "midi_out.h"
#include "midi_tap.h"
#include "mirror.h"
#include "movy_host.h"
#include "param_queue.h"
#include "speaker.h"
#include "surface_keys.h"
#include "vtable.h"

#define FADE_FRAMES ((int)(0.5 * SCHWUNG_SAMPLE_RATE / SCHWUNG_AUDIO_FRAMES))
#define PARAMS_PER_FRAME 8
/* The engine's status into the UI's snapshot every Nth block (WP10). Every
 * block cost ~49 us of audio-thread work (the engine formats ~1.5 KB of text),
 * and the UI parses at most ~107 Hz; every third block is ~115 Hz. */
#define STATUS_EVERY_BLOCKS 3

static pthread_t g_thread;
static volatile int g_stop;
static uint64_t g_frame;
static int g_tid;

uint64_t audio_frame(void) { return __atomic_load_n(&g_frame, __ATOMIC_ACQUIRE); }

int audio_tid(void) { return g_tid; }

/* Hardware, the inject ring, the test bus, then shadow_ui's UI ring (the dev
 * tools'): all one input (midi_in.h). */
static int gather_input(uint8_t *map, uint8_t notes[][4], int max) {
    int n = 0;
    uint64_t now = mh_now_ms();
    uint8_t *in = map + SCHWUNG_OFF_IN_MIDI, pkt[4];
    for (int i = 0; i < SCHWUNG_MIDI_IN_MAX; i++) {
        uint8_t *e = in + i * 8;
        if (!(e[0] | e[1] | e[2] | e[3])) continue;
        speaker_in(e);   /* the hardware's jack report only, never an injected one */
        if (midi_in_feed(e, now) && n < max) memcpy(notes[n++], e, 4);
    }
    mirror_in(in, SCHWUNG_MIDI_IN_MAX * 8);
    /* Events persist in the RX mailbox until overwritten; as its only reader
     * we clear them, or the next frame replays them (boot-select.c). */
    memset(in, 0, SCHWUNG_MIDI_IN_MAX * 8);
    for (int b = 0; b < 16 && inject_ring_pop(pkt); b++)
        if (midi_in_feed(pkt, now) && n < max) memcpy(notes[n++], pkt, 4);
    for (int b = 0; b < 64 && ui_ring_pop(pkt); b++)
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
    int fade = 0, status_div = 0, unlogged = 0;
    /* Whether the frame before this transfer was over budget: a late transfer
     * it explains is already on its glitch line. */
    int prev_over = 0;
    uint64_t prev_work = 0;
    mh_log_limit_t glitch_limit = { 0, 0 };
    static char detail[512];
    while (!g_stop) {
        /* F0 00 21 1D 01 01 39 02 F7: what stock Move sends for every power-button event. Unanswered,
         * the hardware reports the button once per launch and then goes quiet. */
        for (int a = surface_power_ack_take(); a > 0; a--) {
            static const uint8_t ack[3][4] = { { 0x04, 0xF0, 0x00, 0x21 }, { 0x04, 0x1D, 0x01, 0x01 }, { 0x07, 0x39, 0x02, 0xF7 } };
            for (int i = 0; i < 3; i++) midi_out_send_audio(ack[i]);
        }
        int nout = midi_out_take(out);
        memcpy(map + SCHWUNG_OFF_OUT_MIDI, out, (size_t)nout * 4);
        for (int i = 0; i < nout; i++) midi_tap_record(g_frame + 1, out[i]);
        mirror_out((const uint8_t (*)[4])out, nout);
        uint64_t tp = mh_now_us();
        spi_pump(spi);
        memset(map + SCHWUNG_OFF_OUT_MIDI, 0, SCHWUNG_MIDI_OUT_MAX * 4);
        __atomic_add_fetch(&g_frame, 1, __ATOMIC_RELEASE);
        uint64_t t0 = mh_now_us();
        if (frame_stats_transfer(tp, t0) && !prev_over && mh_log_limit(&glitch_limit, t0 / 1000, GLITCH_LINES_PER_S))
            mh_log("audio: late transfer %llu with no over-budget work before it (work %llu us, transfer %llu us)",
                   (unsigned long long)g_frame, (unsigned long long)prev_work, (unsigned long long)(t0 - tp));

        display_serve(map);
        int nn = gather_input(map, notes, 64);
        /* The fallback exit asked for a clean close; a UI that has not let go
         * in time is wedged, and the box must still come back (Move restarts
         * once this process is gone). */
        /* Only while the UI loop still runs: once it has left, onUnload is
         * saving, and that gets the longer bound. */
        uint64_t fb = surface_fallback_at();
        uint64_t since = fb ? mh_now_ms() - fb : 0;
        if (fb && ((g_mh_ui_running && since > FALLBACK_GRACE_MS) || since > 5 * FALLBACK_GRACE_MS)) {
            mh_log("fallback exit: the UI did not let go in %llu ms; hard exit", (unsigned long long)since);
            struct timespec ts = { 0, 50000000L };   /* the log writer's turn */
            nanosleep(&ts, NULL);
            if (handover_armed()) { log_ring_flush_raw(STDERR_FILENO); handover_exec(MH_HANDOVER_CHAIN); }
            _exit(4);
        }
        uint64_t tio = mh_now_us();
        engine_frame_begin();
        for (int i = 0; i < nn; i++) engine_on_midi(notes[i] + 1, 3, notes[i][0] >> 4 == 2);
        int served = pq_service(engine_service, NULL, PARAMS_PER_FRAME);
        uint64_t tr = mh_now_us();
        int rendered = engine_render(buf, SCHWUNG_AUDIO_FRAMES);
        uint64_t render_us = mh_now_us() - tr;
        if (rendered && ++status_div >= STATUS_EVERY_BLOCKS) {
            status_div = 0;
            engine_publish_status(pq_served());
        }
        /* Read inside the lock, and only once the frame is already over: the
         * engine formats it, and a good frame must not pay for that. */
        int over = glitch_over(mh_now_us() - t0);
        if (over) engine_block_detail(detail, sizeof detail);
        engine_frame_end();

        int16_t *dst = (int16_t *)(map + SCHWUNG_OFF_OUT_AUDIO);
        if (!rendered) { memset(dst, 0, sizeof buf); fade = 0; prev_over = 0; continue; }
        mirror_audio(buf, SCHWUNG_AUDIO_FRAMES);
        /* After the mirror, which streams what Move's master bus would: the
         * EQ voices the built-in speaker, not a recording of the mix. */
        speaker_process(buf, SCHWUNG_AUDIO_FRAMES);
        /* Fade in from silence: the hardware may still carry whatever the
         * previous owner left, and a full-scale first block is a click. */
        if (fade < FADE_FRAMES) {
            for (int i = 0; i < SCHWUNG_AUDIO_FRAMES * 2; i++) dst[i] = (int16_t)(buf[i] * fade / FADE_FRAMES);
            fade++;
        } else {
            memcpy(dst, buf, sizeof buf);
        }
        uint64_t work = mh_now_us() - t0;
        frame_stats_work(work);
        /* Render and params apart, and the params' slowest key rather than the
         * last: a chain load is released inside render, and the key serviced
         * last in a slow frame was rarely the one that made it slow (WP11). */
        prev_work = work;
        prev_over = glitch_over(work);
        if (prev_over && !mh_log_limit(&glitch_limit, t0 / 1000, GLITCH_LINES_PER_S)) unlogged++;
        else if (prev_over) {
            static char line[768];
            glitch_t g = { g_frame, (uint32_t)work, (uint32_t)(tio - t0), (uint32_t)(tr - tio), (uint32_t)render_us,
                           nn, served, engine_slowest_key(), (uint32_t)engine_slowest_us(), audio_late_frames(),
                           over ? detail : NULL, unlogged };
            glitch_format(line, sizeof line, &g);
            mh_log("%s", line);
            unlogged = 0;
        }
    }
    return NULL;
}

int audio_start(mh_spi_t *spi) {
    engine_set_mapped(spi->map);
    inject_ring_open();
    ui_ring_open();
    return pthread_create(&g_thread, NULL, audio_main, spi);
}

void audio_stop(void) {
    g_stop = 1;
    pthread_join(g_thread, NULL);
}
