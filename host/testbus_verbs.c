#define _GNU_SOURCE
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "audio.h"
#include "display.h"
#include "log.h"
#include "midi_in.h"
#include "midi_out.h"
#include "midi_tap.h"
#include "movy_host.h"
#include "param_queue.h"
#include "rt.h"
#include "testbus.h"
#include "ui_eval.h"
#include "vtable.h"

#define NS "overtake_dsp:"

static int reply(tb_reply_t *o, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static int reply(tb_reply_t *o, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(o->buf, (size_t)o->cap, fmt, ap);
    va_end(ap);
    return 0;
}

static void hex(char *out, const uint8_t *b, int n) {
    for (int i = 0; i < n; i++) sprintf(out + i * 2, "%02x", b[i]);
}

static int unhex(const char *s, uint8_t *b, int n) {
    if ((int)strlen(s) != n * 2) return -1;
    for (int i = 0; i < n; i++) {
        unsigned v;
        if (sscanf(s + i * 2, "%2x", &v) != 1) return -1;
        b[i] = (uint8_t)v;
    }
    return 0;
}

/* Frames, not wall clock: polled at 1 ms so the audio thread signals nothing. */
static int wait_frame(const char *arg, tb_reply_t *o) {
    long n = strtol(arg, NULL, 10);
    if (n < 1 || n > 10000) return reply(o, "ERR WAIT_FRAME: n must be 1..10000");
    uint64_t target = audio_frame() + (uint64_t)n, deadline = mh_now_ms() + 30000;
    while (audio_frame() < target) {
        if (mh_now_ms() > deadline) return reply(o, "ERR WAIT_FRAME: timeout (audio thread not ticking?)");
        struct timespec ts = { 0, 1000000 };
        nanosleep(&ts, NULL);
    }
    return reply(o, "OK frame=%llu", (unsigned long long)audio_frame());
}

static const char *strip_ns(const char *k) { return strncmp(k, NS, strlen(NS)) == 0 ? k + strlen(NS) : k; }

static int get_param(const char *key, tb_reply_t *o) {
    if (!engine_loaded()) return reply(o, "ERR GET_PARAM: engine not loaded");
    key = strip_ns(key);
    if (strcmp(key, "__ready") == 0) return reply(o, "OK 1");
    int n = pq_get(key, o->buf + 3, o->cap - 3, 1000);
    if (n < 0) return reply(o, "OK ");   /* the engine's own "unknown key" answer */
    memcpy(o->buf, "OK ", 3);
    for (int i = 3; i < n + 3; i++) if (o->buf[i] == '\n') o->buf[i] = ' ';
    return 0;
}

static int set_param(char *args, tb_reply_t *o) {
    char *sp = strchr(args, ' ');
    if (!sp) return reply(o, "ERR SET_PARAM: usage SET_PARAM <key> <value>");
    *sp = '\0';
    if (!engine_loaded()) return reply(o, "ERR SET_PARAM: engine not loaded");
    /* Applied before the reply: the waiter returns once set_param ran. */
    return pq_set(strip_ns(args), sp + 1, 2000) ? reply(o, "OK") : reply(o, "ERR SET_PARAM: timeout");
}

static int state(tb_reply_t *o) {
    int run = __atomic_load_n(&g_mh_ui_running, __ATOMIC_ACQUIRE);
    unsigned long long f = (unsigned long long)audio_frame();
    uint32_t wavg, wmax;
    audio_work_us(&wavg, &wmax);
    return reply(o, "OK frame=%llu running=%d engine_ready=%d inject_queued=%u uid=%d rt=%s "
                    "param_depth=%d ui_dropped=%u overtake_mode=%d shim_counter=%llu "
                    "work_avg_us=%u work_max_us=%u",
                 f, run, engine_loaded(), midi_in_inject_queued(), (int)getuid(), rt_state(),
                 pq_depth(), midi_in_ui_dropped(), run ? 2 : 0, f, wavg, wmax);
}

int testbus_handle(const char *line, tb_reply_t *o) {
    char verb[32] = "", *args;
    char *copy = strdup(line);
    char *sp = strchr(copy, ' ');
    args = sp ? (*sp = '\0', sp + 1) : copy + strlen(copy);
    snprintf(verb, sizeof verb, "%s", copy);
    int close_after = 0;
    uint8_t b[1024];
    if (!strcmp(verb, "PING")) reply(o, "OK movy-host %s proto=1 schwung=%s movy=%s pid=%d", MH_VERSION, SCHWUNG_TAG, MOVY_COMMIT, (int)getpid());
    else if (!strcmp(verb, "STATE")) state(o);
    else if (!strcmp(verb, "WAIT_FRAME")) wait_frame(args, o);
    else if (!strcmp(verb, "GET_PARAM")) get_param(args, o);
    else if (!strcmp(verb, "SET_PARAM")) set_param(args, o);
    else if (!strcmp(verb, "INJECT_MIDI")) {
        if (unhex(args, b, 4)) reply(o, "ERR INJECT_MIDI: want 8 hex digits");
        else reply(o, midi_in_inject_push(b) ? "OK" : "ERR INJECT_MIDI: queue full");
    } else if (!strcmp(verb, "SNAPSHOT_PAD_LEDS")) {
        midi_out_pad_snapshot(b);
        memcpy(o->buf, "OK ", 3);
        hex(o->buf + 3, b, 32);
    } else if (!strcmp(verb, "FB")) {
        display_on_glass(b);
        memcpy(o->buf, "OK ", 3);
        hex(o->buf + 3, b, 1024);
    } else if (!strcmp(verb, "QUIT")) { reply(o, "OK bye"); close_after = 1; }
    else if (!strcmp(verb, "EXIT")) { reply(o, "OK bye"); close_after = 1; g_mh_quit = 1; }
    else if (!strcmp(verb, "SET_OPEN_TOOL")) reply(o, "ERR SET_OPEN_TOOL: no Move — movy-host is already the tool");
    else if (!strcmp(verb, "RESTART_MOVE")) reply(o, "ERR RESTART_MOVE: no Move — use EXIT and relaunch");
    else if (!strcmp(verb, "LOG_SEQ")) testbus_log_seq(o);
    else if (!strcmp(verb, "LOG_TAIL")) testbus_log_tail(args, o);
    else if (!strcmp(verb, "SUBSCRIBE") || !strcmp(verb, "UNSUBSCRIBE") || !strcmp(verb, "DUMP")) {
        if (strcmp(args, "midi_out")) reply(o, "ERR %s: unknown channel '%s' (midi_out)", verb, args);
        else if (!strcmp(verb, "DUMP")) midi_tap_dump(o);
        else { if (verb[0] == 'S') midi_tap_subscribe(); else midi_tap_unsubscribe(); reply(o, "OK"); }
    } else if (!strcmp(verb, "UI_EVAL")) ui_eval_request(args, o->buf, o->cap, 5000);
#ifdef MOVY_TESTBUS_EVAL
    /* Dev builds only: the proof that a native crash leaves a backtrace in
     * debug.log (plan WP7 T4). No reply — the process is gone. */
    else if (!strcmp(verb, "CRASH")) { mh_log("testbus: CRASH requested"); volatile int *p = NULL; *p = 1; }
#endif
    else reply(o, "ERR %s: unknown verb", verb[0] ? verb : "?");
    free(copy);
    return close_after;
}
