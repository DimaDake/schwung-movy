// movy-lab — WP0 feasibility spike (plans/2026-10-09-standalone-migration.md).
//
// A throwaway standalone tool: owns /dev/ablspi0.0 with Move stopped, paints
// through QuickJS + js_display from a PINNED schwung tag, runs the unchanged
// movy dsp.so through plugin_api_v2 with a hand-made host vtable, plays a pad
// note into a 2-chain set, logs every MIDI_IN event, and measures the frame.
// Everything it learns goes to LAB_LOG; stdout is /dev/null under
// launch-standalone.sh. Deleted in WP6.

#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "quickjs.h"
#include "js_display.h"
#include "plugin_api_v1.h"
#include "lib/schwung_spi_lib.h"

#define LAB_LOG    "/data/UserData/schwung/movy-lab.log"
#define MOVY_DIR   "/data/UserData/schwung/modules/tools/movy"
#define CHAIN_DIR  "/data/UserData/schwung/modules/chain"
#define LAB_DIR    "/data/UserData/schwung/modules/tools/movy-lab"
#define FRAMES     SCHWUNG_AUDIO_FRAMES
#define MAX_SAMPLES 40000   /* > 60 s of frames at ~345 Hz */

static FILE *g_log;
static pthread_mutex_t g_log_mu = PTHREAD_MUTEX_INITIALIZER;
static volatile sig_atomic_t g_quit;
static struct timespec g_term_at;
static int g_midi_internal, g_midi_external;

static double now_s(clockid_t c) {
    struct timespec ts;
    clock_gettime(c, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

static void lab_log(const char *fmt, ...) {
    va_list ap;
    pthread_mutex_lock(&g_log_mu);
    fprintf(g_log, "%.3f ", now_s(CLOCK_REALTIME));
    va_start(ap, fmt);
    vfprintf(g_log, fmt, ap);
    va_end(ap);
    fputc('\n', g_log);
    fflush(g_log);
    pthread_mutex_unlock(&g_log_mu);
}

/* ── host vtable handed to dsp.so ─────────────────────────────────────── */
static void host_log(const char *msg) { lab_log("dsp: %s", msg); }
static int host_midi_internal(const uint8_t *m, int n) { (void)m; g_midi_internal++; return n; }
static int host_midi_external(const uint8_t *m, int n) { (void)m; g_midi_external++; return n; }
static host_api_v1_t g_host = {
    .api_version = 1, .sample_rate = SCHWUNG_SAMPLE_RATE, .frames_per_block = FRAMES,
    .audio_out_offset = SCHWUNG_OFF_OUT_AUDIO, .audio_in_offset = SCHWUNG_OFF_IN_AUDIO,
    .log = host_log, .midi_send_internal = host_midi_internal,
    .midi_send_external = host_midi_external,
};

static void on_term(int sig) {
    (void)sig;
    if (!g_quit) clock_gettime(CLOCK_MONOTONIC, &g_term_at);
    g_quit = 1;
}

/* ── stats ────────────────────────────────────────────────────────────── */
typedef struct { float v[MAX_SAMPLES]; int n; } series_t;
static series_t s_render, s_work, s_period, s_txdelta;

static void push(series_t *s, double us) { if (s->n < MAX_SAMPLES) s->v[s->n++] = (float)us; }
static int cmpf(const void *a, const void *b) {
    float x = *(const float *)a, y = *(const float *)b;
    return (x > y) - (x < y);
}
static void report(const char *name, series_t *s) {
    if (s->n == 0) { lab_log("stat %s: no samples", name); return; }
    qsort(s->v, s->n, sizeof(float), cmpf);
    double sum = 0;
    for (int i = 0; i < s->n; i++) sum += s->v[i];
    lab_log("stat %s: n=%d mean=%.1f p50=%.1f p99=%.1f p999=%.1f max=%.1f us", name, s->n,
            sum / s->n, s->v[s->n / 2], s->v[(int)(s->n * 0.99)], s->v[(int)(s->n * 0.999)],
            s->v[s->n - 1]);
}

/* ── SPI glue, the boot-select.c shape ────────────────────────────────── */
#define IOC(nr) _IOC(_IOC_NONE, 0, (nr), 0)
static uint8_t g_packed[SCHWUNG_DISPLAY_SIZE];

/* Display is a PULL protocol: answer the slice index the XMOS asks for. */
static void serve_display(uint8_t *map) {
    uint32_t idx;
    memcpy(&idx, map + SCHWUNG_OFF_IN_DISP_STAT, 4);
    if (idx < 1 || idx > 6) return;
    int off = (int)(idx - 1) * SCHWUNG_OUT_DISP_CHUNK_LEN;
    int len = idx == 6 ? SCHWUNG_DISPLAY_SIZE - off : SCHWUNG_OUT_DISP_CHUNK_LEN;
    memcpy(map + SCHWUNG_OFF_OUT_DISP_STAT, &idx, 4);
    memcpy(map + SCHWUNG_OFF_OUT_DISP_DATA, g_packed + off, len);
}

static void pump(int fd) { ioctl(fd, IOC(SCHWUNG_IOCTL_WAIT_SEND_SIZE), 0x300); }

/* ── engine ───────────────────────────────────────────────────────────── */
static plugin_api_v2_t *g_api;
static void *g_inst;

static void engine_note(int on) {
    uint8_t m[3] = { (uint8_t)(on ? 0x90 : 0x80), 68, (uint8_t)(on ? 100 : 0) };
    g_api->on_midi(g_inst, m, 3, 0);
}

static const char *engine_get(const char *key, char *buf, int len) {
    if (g_api->get_param(g_inst, key, buf, len) < 0) snprintf(buf, len, "-");
    return buf;
}

/* Two chains, the length-prefixed triple format of chain_doc.rs. */
static void engine_load_set(void) {
    const char *e[] = { "0", "synth", "noisemaker", "1", "synth", "braids" };
    char doc[512];
    int p = snprintf(doc, sizeof doc, "6\n");
    for (int i = 0; i < 6; i++) p += snprintf(doc + p, sizeof doc - p, "%zu\n%s", strlen(e[i]), e[i]);
    g_api->set_param(g_inst, "chain_host", CHAIN_DIR "|" LAB_DIR);
    g_api->set_param(g_inst, "chains", doc);
    char map[256];
    p = snprintf(map, sizeof map, "0");
    for (int i = 0; i < 32; i++) p += snprintf(map + p, sizeof map - p, ",%d", 48 + i);
    g_api->set_param(g_inst, "padmap", map);
}

static int engine_open(const char *so) {
    void *h = dlopen(so, RTLD_NOW | RTLD_LOCAL);
    if (!h) { lab_log("dlopen %s failed: %s", so, dlerror()); return 0; }
    move_plugin_init_v2_fn init = (move_plugin_init_v2_fn)dlsym(h, "move_plugin_init_v2");
    if (!init) { lab_log("no move_plugin_init_v2 in %s", so); return 0; }
    g_api = init(&g_host);
    g_inst = g_api ? g_api->create_instance(MOVY_DIR, "{}") : NULL;
    lab_log("engine: api=%p inst=%p", (void *)g_api, g_inst);
    return g_inst != NULL;
}

/* ── UI: QuickJS paints through js_display ────────────────────────────── */
static JSContext *g_js;
static const char *JS_SRC =
    "globalThis.frame = function (s) {\n"
    "  clear_screen();\n"
    "  print(0, 0, 'movy-lab ' + s.tag, 1);\n"
    "  print(0, 10, 'uid ' + s.uid + ' rt ' + s.rt, 1);\n"
    "  print(0, 20, 't ' + s.t + 's render ' + s.r + 'us', 1);\n"
    "  print(0, 30, 'peak ' + s.peak, 1);\n"
    "  print(0, 40, 'midi ' + s.midi, 1);\n"
    "  print(0, 52, 'exit in ' + s.left + 's', 1);\n"
    "};\n";

static int js_open(void) {
    JSRuntime *rt = JS_NewRuntime();
    g_js = JS_NewContext(rt);
    JSValue global = JS_GetGlobalObject(g_js);
    js_display_register_bindings(g_js, global);
    JS_FreeValue(g_js, global);
    JSValue r = JS_Eval(g_js, JS_SRC, strlen(JS_SRC), "<lab>", JS_EVAL_TYPE_GLOBAL);
    int ok = !JS_IsException(r);
    JS_FreeValue(g_js, r);
    return ok;
}

static void js_frame(const char *json) {
    char src[768];
    snprintf(src, sizeof src, "frame(%s)", json);
    JSValue r = JS_Eval(g_js, src, strlen(src), "<frame>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) {
        JSValue ex = JS_GetException(g_js);
        const char *m = JS_ToCString(g_js, ex);
        lab_log("js exception: %s", m ? m : "?");
        JS_FreeCString(g_js, m);
        JS_FreeValue(g_js, ex);
    }
    JS_FreeValue(g_js, r);
    js_display_pack(g_packed);
}

static uint8_t *open_display_live(void) {
    int fd = shm_open("/schwung-display-live", O_RDWR | O_CREAT, 0666);
    if (fd < 0) { lab_log("display-live shm_open: %s", strerror(errno)); return NULL; }
    struct stat st;
    if (fstat(fd, &st) == 0 && st.st_size < SCHWUNG_DISPLAY_SIZE) ftruncate(fd, SCHWUNG_DISPLAY_SIZE);
    void *p = mmap(NULL, SCHWUNG_DISPLAY_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    lab_log("display-live: size was %ld, mapped=%d", (long)st.st_size, p != MAP_FAILED);
    return p == MAP_FAILED ? NULL : p;
}

/* ── realtime ─────────────────────────────────────────────────────────── */
static char g_rt[48] = "other";

static void try_realtime(void) {
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(3, &set);   /* Move's SPI thread lives on core 3 */
    int aff = sched_setaffinity(0, sizeof set, &set);
    struct sched_param sp = { .sched_priority = 70 };
    int rc = pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
    int ml = mlockall(MCL_CURRENT | MCL_FUTURE);
    if (rc == 0) snprintf(g_rt, sizeof g_rt, "fifo70");
    else snprintf(g_rt, sizeof g_rt, "EPERM(%d)", rc);
    lab_log("realtime: SCHED_FIFO 70 -> %s (%s); affinity core3 -> %d; mlockall -> %d (%s)",
            rc == 0 ? "ok" : "FAILED", strerror(rc), aff, ml, ml ? strerror(errno) : "ok");
}

/* ── MIDI_IN: log every event, feed pads to the engine ────────────────── */
static char g_last_midi[32] = "-";
static int g_midi_logged;

static void scan_midi_in(uint8_t *map) {
    uint8_t *in = map + SCHWUNG_OFF_IN_MIDI;
    for (int i = 0; i < SCHWUNG_MIDI_IN_MAX; i++) {
        uint8_t *e = in + i * 8;
        if (!(e[0] | e[1] | e[2] | e[3])) continue;
        int cable = e[0] >> 4, cin = e[0] & 0xF;
        uint32_t ts;
        memcpy(&ts, e + 4, 4);
        snprintf(g_last_midi, sizeof g_last_midi, "c%d %02x %02x %02x", cable, e[1], e[2], e[3]);
        if (g_midi_logged++ < 4000)
            lab_log("midi_in cable=%d cin=%x bytes=%02x %02x %02x ts=%u", cable, cin, e[1], e[2], e[3], ts);
        int type = e[1] & 0xF0;
        if (cable == 0 && (type == 0x90 || type == 0x80) && e[2] >= 68 && e[2] < 100)
            g_api->on_midi(g_inst, e + 1, 3, 0);
    }
    /* Events persist in the RX mailbox until overwritten; as the sole owner we
     * clear them so the next frame does not replay them (boot-select.c). */
    memset(in, 0, SCHWUNG_MIDI_IN_MAX * 8);
}

int main(int argc, char **argv) {
    int secs = argc > 1 ? atoi(argv[1]) : 60;
    const char *so = argc > 2 ? argv[2] : MOVY_DIR "/dsp.so";
    g_log = fopen(LAB_LOG, "a");
    if (!g_log) g_log = stderr;
    double t_start = now_s(CLOCK_MONOTONIC);
    lab_log("=== movy-lab start schwung=%s movy=%s pid=%d ppid=%d uid=%d euid=%d secs=%d",
            SCHWUNG_TAG, MOVY_COMMIT, getpid(), getppid(), getuid(), geteuid(), secs);

    struct sigaction sa = { .sa_handler = on_term };
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);

    lab_log("js: %s", js_open() ? "ok" : "FAILED");
    int have_engine = engine_open(so);
    if (have_engine) engine_load_set();
    uint8_t *live = open_display_live();

    int fd = open(SCHWUNG_SPI_DEVICE, O_RDWR);
    if (fd < 0) { lab_log("spi open: %s", strerror(errno)); return 1; }
    uint8_t *map = mmap(NULL, SCHWUNG_PAGE_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) { lab_log("spi mmap: %s", strerror(errno)); return 1; }
    memset(map, 0, SCHWUNG_PAGE_SIZE);
    ioctl(fd, IOC(SCHWUNG_IOCTL_SET_SPEED), 20000000);
    /* MIDI system reset ends the XMOS power-on LED show (boot-select.c). */
    map[0] = 0x0F; map[1] = 0xFF;
    pump(fd);
    memset(map, 0, 4);
    lab_log("spi: open after %.0f ms", (now_s(CLOCK_MONOTONIC) - t_start) * 1000);
    try_realtime();

    int16_t buf[FRAMES * 2];
    uint64_t last_tx = 0;
    double last_return = 0, next_ui = 0, next_peak = 0, note_off_at = -1, next_note = 3.0;
    char peak[256] = "-", json[512];
    long frame = 0;
    while (!g_quit && now_s(CLOCK_MONOTONIC) - t_start < secs) {
        double before = now_s(CLOCK_MONOTONIC);
        if (last_return > 0) push(&s_work, (before - last_return) * 1e6);
        pump(fd);
        double after = now_s(CLOCK_MONOTONIC);
        if (last_return > 0) push(&s_period, (after - last_return) * 1e6);
        last_return = after;
        uint64_t tx;
        memcpy(&tx, map + SCHWUNG_OFF_SPI_TX_TIME, 8);
        if (last_tx && tx > last_tx) push(&s_txdelta, (tx - last_tx) / 1e3);
        last_tx = tx;

        serve_display(map);
        double t = after - t_start;
        if (have_engine) {
            scan_midi_in(map);
            if (t >= next_note) { engine_note(1); note_off_at = t + 0.4; next_note += 2.0; }
            if (note_off_at > 0 && t >= note_off_at) { engine_note(0); note_off_at = -1; }
            double r0 = now_s(CLOCK_MONOTONIC);
            g_api->render_block(g_inst, buf, FRAMES);
            push(&s_render, (now_s(CLOCK_MONOTONIC) - r0) * 1e6);
            /* Fade in over 0.5 s at half gain: nothing Move used to apply
             * (master volume) applies here. */
            double g = 0.5 * fmin(1.0, t / 0.5);
            int16_t *out = (int16_t *)(map + SCHWUNG_OFF_OUT_AUDIO);
            for (int i = 0; i < FRAMES * 2; i++) out[i] = (int16_t)(buf[i] * g);
            if (t >= next_peak && t < 12) {
                char gen[32];
                engine_get("chpeak", peak, sizeof peak);
                lab_log("engine t=%.2f chpeak=%s chgen=%s", t, peak, engine_get("chgen", gen, sizeof gen));
                next_peak = t + 0.5;
            }
        } else {
            scan_midi_in(map);
        }
        if (t >= next_ui) {
            float r = s_render.n ? s_render.v[s_render.n - 1] : 0;
            snprintf(json, sizeof json,
                     "{tag:'%s',uid:%d,rt:'%s',t:%d,r:%d,peak:'%.12s',midi:'%s',left:%d}",
                     SCHWUNG_TAG, getuid(), g_rt, (int)t, (int)r, peak, g_last_midi, secs - (int)t);
            js_frame(json);
            if (live) memcpy(live, g_packed, SCHWUNG_DISPLAY_SIZE);
            next_ui = t + 0.25;
        }
        frame++;
    }
    double stop = now_s(CLOCK_MONOTONIC);
    lab_log("loop end: frames=%ld quit=%d midi_internal=%d midi_external=%d", frame, (int)g_quit,
            g_midi_internal, g_midi_external);

    if (have_engine) { engine_note(0); g_api->destroy_instance(g_inst); }
    memset(map + SCHWUNG_OFF_OUT_AUDIO, 0, FRAMES * 4);
    js_display_clear();
    js_display_pack(g_packed);
    for (int i = 0; i < 16; i++) { pump(fd); serve_display(map); }
    memset(map + SCHWUNG_OFF_OUT_DISP_STAT, 0, 4);
    munmap(map, SCHWUNG_PAGE_SIZE);
    close(fd);

    report("render", &s_render);
    report("work_between_pumps", &s_work);
    report("frame_period", &s_period);
    report("spi_tx_delta", &s_txdelta);
    if (g_quit) {
        double term = g_term_at.tv_sec + g_term_at.tv_nsec / 1e9;
        lab_log("sigterm: loop left %.1f ms after the signal, exit %.1f ms after",
                (stop - term) * 1000, (now_s(CLOCK_MONOTONIC) - term) * 1000);
    }
    lab_log("=== movy-lab exit 0 after %.1f s", now_s(CLOCK_MONOTONIC) - t_start);
    return 0;
}
