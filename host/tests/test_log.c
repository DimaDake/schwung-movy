/* movy-host's test-bus channels: the log ring (LOG_SEQ / LOG_TAIL) and the
 * midi_out tap (SUBSCRIBE / DUMP). */
#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "log_ring.h"
#include "midi_tap.h"
#include "testbus.h"

static int checks, fails;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

#define THREADS 4
#define PER 3000   /* 12000 lines through a 4096 ring: the writer must keep up */

static int g_seen[THREADS], g_order_ok = 1, g_total;
static uint32_t g_last_seq;
static void count_sink(const log_line_t *l) {
    int t, i;
    if (sscanf(l->text, "t%d i%d", &t, &i) != 2 || t < 0 || t >= THREADS) return;
    if (i != g_seen[t] || l->seq <= g_last_seq) g_order_ok = 0;
    g_seen[t] = i + 1;
    g_last_seq = l->seq;
    g_total++;
}

static void *producer(void *arg) {
    int t = (int)(long)arg;
    char b[32];
    for (int i = 0; i < PER; i++) {
        snprintf(b, sizeof b, "t%d i%d", t, i);
        log_ring_push(t ? "movy-dsp" : "shadow", b);
        if (i % 512 == 0) { struct timespec ts = { 0, 1000000L }; nanosleep(&ts, NULL); }
    }
    return NULL;
}

/* The bug this replaces: unified_log's TRYLOCK dropped a line whenever two
 * threads logged at once, which is how reselect lost `undo: LOAD MODULE` to
 * a module load on the audio thread. Every line must arrive, once, in order. */
static void test_ring_concurrent(void) {
    log_ring_start(count_sink);
    pthread_t th[THREADS];
    for (long t = 0; t < THREADS; t++) pthread_create(&th[t], NULL, producer, (void *)t);
    for (int t = 0; t < THREADS; t++) pthread_join(th[t], NULL);
    log_ring_stop();
    CHECK(g_total == THREADS * PER, "every line from %d threads reached the writer (%d of %d, lost %u)",
          THREADS, g_total, THREADS * PER, log_ring_lost());
    CHECK(g_order_ok, "each thread's lines arrive in order, by sequence");
    CHECK(log_ring_seq() == THREADS * PER, "sequence numbers are dense (%u)", log_ring_seq());
}

static char g_buf[1 << 16];
static int bus(const char *line) {
    tb_reply_t o = { g_buf, sizeof g_buf };
    char *copy = strdup(line), *sp = strchr(copy, ' ');
    if (sp) *sp = '\0';
    int r = !strcmp(copy, "LOG_SEQ") ? testbus_log_seq(&o) : testbus_log_tail(sp ? sp + 1 : "", &o);
    free(copy);
    return r;
}
static int lines_in(const char *s, const char *pfx) {
    int n = 0;
    for (const char *p = s; (p = strstr(p, pfx)); p++) n++;
    return n;
}

static void test_tail(void) {
    uint32_t base = log_ring_seq();
    log_ring_push("shadow", "[movy] seq: set ready");
    log_ring_push("movy-dsp", "chain 0: synth = rex");
    log_ring_push("shadow", "[movy] undo: LOAD MODULE synth");
    bus("LOG_SEQ");
    char want[32];
    snprintf(want, sizeof want, "OK seq=%u", base + 3);
    CHECK(!strcmp(g_buf, want), "LOG_SEQ is the last line: %s", g_buf);

    char req[64];
    snprintf(req, sizeof req, "LOG_TAIL %u", base);
    bus(req);
    CHECK(!strncmp(g_buf, "OK count=3 ", 11) && lines_in(g_buf, "\nLN ") == 3 && strstr(g_buf, "\nEND"),
          "three lines after the baseline: %s", g_buf);
    snprintf(req, sizeof req, "LOG_TAIL %u [movy] undo:", base);
    bus(req);
    CHECK(!strncmp(g_buf, "OK count=1 ", 11) && strstr(g_buf, "[shadow] [movy] undo: LOAD MODULE"),
          "a substring of \"[src] text\" filters, spaces included: %s", g_buf);
    snprintf(req, sizeof req, "LOG_TAIL %u", base + 3);
    bus(req);
    CHECK(!strncmp(g_buf, "OK count=0 ", 11), "nothing after the last line: %s", g_buf);

    /* A from older than the ring reports how much it missed. */
    bus("LOG_TAIL 0 no-such-text");
    CHECK(strstr(g_buf, " lost=") != NULL, "a from the ring wrapped past says lost=: %.60s", g_buf);

    /* A reply bounded by the bus buffer pages with more=1. */
    for (int i = 0; i < 600; i++) log_ring_push("shadow", "padding line padding line padding line padding line padding line padding line padding line padding line padding line padding line");
    snprintf(req, sizeof req, "LOG_TAIL %u", base);
    bus(req);
    CHECK(strstr(g_buf, " more=1") != NULL && strstr(g_buf, "\nEND"), "a full reply pages: %.60s", g_buf);
    CHECK(bus("LOG_TAIL x") == 0 && !strncmp(g_buf, "ERR LOG_TAIL:", 13), "a bad from is an ERR");
}

static void test_tap(void) {
    tb_reply_t o = { g_buf, sizeof g_buf };
    uint8_t p[4] = { 0x09, 0x90, 68, 21 };
    midi_tap_record(1, p);
    midi_tap_dump(&o);
    CHECK(!strncmp(g_buf, "ERR DUMP:", 9), "DUMP before SUBSCRIBE is an ERR");
    midi_tap_subscribe();
    midi_tap_record(7, p);
    p[3] = 0;
    midi_tap_record(8, p);
    midi_tap_dump(&o);
    CHECK(!strcmp(g_buf, "OK count=2 dropped=0\nEV 00000007 09904415\nEV 00000008 09904400\nEND"),
          "two events since subscribe, testd's shape: %s", g_buf);
    midi_tap_dump(&o);
    CHECK(!strcmp(g_buf, "OK count=0 dropped=0\nEND"), "a DUMP drains: %s", g_buf);
    for (uint32_t i = 0; i < MIDI_TAP_CAP + 5; i++) midi_tap_record(100 + i, p);
    midi_tap_dump(&o);
    CHECK(!strncmp(g_buf, "OK count=", 9) && strstr(g_buf, "dropped=5") && strstr(g_buf, "EV 00000069 "),
          "overflow drops the OLDEST and counts them: %.40s", g_buf);
    midi_tap_unsubscribe();
    midi_tap_record(1, p);
    midi_tap_dump(&o);
    CHECK(!strncmp(g_buf, "ERR DUMP:", 9), "unsubscribed records nothing");
}

int main(void) {
    test_ring_concurrent();
    test_tail();
    test_tap();
    printf("%s: %d checks, %d failed\n", fails ? "LOG TESTS FAILED" : "LOG TESTS OK", checks, fails);
    return fails != 0;
}
