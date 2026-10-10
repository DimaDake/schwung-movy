/* Unit tests for movy-host's pure modules (input, output, params). Built
 * natively and in a Linux container (scripts/test-host-linux.sh) — macOS and
 * glibc disagree on enough opaque types that one is not proof of the other. */
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "deltas.h"
#include "midi_in.h"
#include "midi_out.h"
#include "param_bulk.h"
#include "param_queue.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

uint64_t mh_now_ms(void) { return 0; }

static void test_deltas(void) {
    CHECK(delta_encode(1) == 1 && delta_encode(200) == 63, "cw encode");
    CHECK(delta_encode(-1) == 127 && delta_encode(-200) == 65, "ccw encode");
    for (int d = -63; d <= 63; d++) if (d) CHECK(delta_decode(delta_encode(d)) == d, "round trip %d", d);
    deltas_t d = { { 0 }, 0 };
    uint8_t cw[3] = { 0xB0, 72, 1 }, ccw[3] = { 0xB0, 72, 127 }, jog[3] = { 0xB0, 14, 2 }, other[3] = { 0xB0, 49, 127 };
    CHECK(deltas_absorb(&d, cw) && deltas_absorb(&d, cw) && deltas_absorb(&d, cw) && deltas_absorb(&d, ccw), "knob absorbed");
    CHECK(deltas_absorb(&d, jog), "jog absorbed");
    CHECK(!deltas_absorb(&d, other), "shift not absorbed");
    uint8_t out[9][3];
    int n = deltas_flush(&d, out);
    CHECK(n == 2 && out[0][1] == 72 && out[0][2] == 2 && out[1][1] == 14 && out[1][2] == 2, "one CC per encoder, summed");
    CHECK(deltas_flush(&d, out) == 0, "flush clears");
}

static void test_midi_in(void) {
    midi_in_reset();
    uint8_t pad[4] = { 0x09, 0x90, 68, 100 }, touch[4] = { 0x09, 0x90, 2, 127 }, cc[4] = { 0x0B, 0xB0, 71, 1 };
    uint8_t ext[4] = { 0x29, 0x90, 60, 100 }, rt[4] = { 0x0F, 0xF8, 0, 0 };
    CHECK(midi_in_feed(pad, 0) == 1, "pad note goes to the engine");
    CHECK(midi_in_feed(touch, 0) == 0, "knob touch does not");
    CHECK(midi_in_feed(cc, 0) == 0, "CC does not");
    CHECK(midi_in_feed(ext, 0) == 0, "cable 2 does not");
    CHECK(midi_in_feed(rt, 0) == 0, "realtime CIN dropped");
    uint8_t p[4];
    int n = 0;
    while (midi_in_ui_pop(p)) n++;
    CHECK(n == 4, "every voice/sysex packet reaches the UI (got %d)", n);

    uint8_t s3[4] = { 0x09, 0x90, 19, 127 }, s5[4] = { 0x09, 0x90, 21, 127 }, s3off[4] = { 0x08, 0x80, 19, 0 };
    midi_in_feed(s3, 1000);
    CHECK(midi_in_held_step() == 3, "one held step");
    CHECK(!midi_in_held_step_is_hold(1499) && midi_in_held_step_is_hold(1500), "tap/hold at 500 ms");
    midi_in_feed(s5, 1000);
    CHECK(midi_in_held_step() == -1, "two held steps name none");
    midi_in_feed(s3off, 1000);
    CHECK(midi_in_held_step() == 5, "release leaves the other");
    uint8_t del[4] = { 0x0B, 0xB0, 119, 127 }, delup[4] = { 0x0B, 0xB0, 119, 0 };
    midi_in_feed(del, 0);
    CHECK(midi_in_delete_held(), "delete down");
    midi_in_feed(delup, 0);
    CHECK(!midi_in_delete_held(), "delete up");
    int pushed = 0;
    while (midi_in_inject_push(pad)) pushed++;
    CHECK(pushed == MIDI_IN_INJECT_CAP && midi_in_inject_queued() == MIDI_IN_INJECT_CAP, "inject queue bounded");
}

static void test_midi_out(void) {
    midi_out_reset();
    uint8_t red[4] = { 0x09, 0x90, 68, 5 }, blue[4] = { 0x09, 0x91, 68, 9 }, btn[4] = { 0x0B, 0xB0, 49, 127 };
    midi_out_send(0, red, 4);
    midi_out_send(0, blue, 4);
    midi_out_send(0, btn, 4);
    uint8_t out[MIDI_OUT_PER_FRAME][4];
    int n = midi_out_take(out);
    CHECK(n == 2, "last writer wins per note (got %d)", n);
    CHECK(out[0][1] == 0x91 && out[0][3] == 9, "the later packet, channel kept");
    CHECK(out[1][2] == 49, "notes before CCs");
    uint8_t snap[32];
    midi_out_pad_snapshot(snap);
    CHECK(snap[0] == 9, "snapshot is what was sent");
    for (int i = 0; i < 40; i++) { uint8_t p[4] = { 0x09, 0x90, (uint8_t)(68 + (i % 32)), 1 }; midi_out_send(0, p, 4); }
    CHECK(midi_out_take(out) == MIDI_OUT_PER_FRAME, "20 a frame");
    CHECK(midi_out_take(out) == 12, "the rest next frame");
    uint8_t sysex[8] = { 0x04, 0xF0, 0x00, 0x21, 0x07, 0x1D, 0xF7, 0x00 };
    CHECK(midi_out_send(0, sysex, 8), "sysex queued");
    CHECK(midi_out_take(out) == 2 && out[0][1] == 0xF0, "sysex in order, uncoalesced");
    CHECK(!midi_out_send(0, sysex, 7), "partial packets refused");
}

/* ── params ── */
static char g_log[4096];
static void fake_service(void *ctx, pq_req_t *r) {
    strcat(g_log, r->kind == PQ_GET ? "G:" : "S:");
    strcat(g_log, r->key);
    strcat(g_log, ";");
    if (r->kind == PQ_GET) r->result = sprintf(r->value, "v-%s", r->key);
}
static void *servicer(void *arg) {
    for (int i = 0; i < 400; i++) { pq_service(fake_service, NULL, 8); usleep(1000); }
    return NULL;
}

static void test_params(void) {
    g_log[0] = 0;
    pq_set("a", "1", 0);
    pq_set("b", "2", 0);
    pthread_t t;
    pthread_create(&t, NULL, servicer, NULL);
    char buf[64];
    int n = pq_get("c", buf, sizeof buf, 1000);
    CHECK(n == 3 && !strcmp(buf, "v-c"), "get answered (%d %s)", n, buf);
    CHECK(pq_set("d", "4", 1000) == 1, "blocking set applied");
    pthread_join(t, NULL);
    CHECK(!strcmp(g_log, "S:a;S:b;G:c;S:d;"), "FIFO, no write lost: %s", g_log);

    g_log[0] = 0;
    CHECK(pq_set("late", "x", 5) == 0, "a set nobody serviced times out");
    CHECK(pq_get("gone", buf, sizeof buf, 5) == -1, "a get nobody serviced times out");
    pq_service(fake_service, NULL, 8);
    CHECK(!strcmp(g_log, "S:late;"), "an abandoned WRITE still applies, an abandoned read is skipped: %s", g_log);
}

static int fget(void *c, const char *k, char *b, int cap) { return sprintf(b, "<%s>", k); }
static char g_set[256];
static void fset(void *c, const char *k, const char *v) { strcat(g_set, k); strcat(g_set, "="); strcat(g_set, v); strcat(g_set, ";"); }

static void test_bulk(void) {
    char out[256];
    const char *req = "2\n1\na2\nbc";
    int n = bulk_get(req, (int)strlen(req), out, sizeof out, fget, NULL);
    CHECK(n > 0 && !strcmp(out, "2\n3\n<a>4\n<bc>"), "bulk get: %s", out);
    const char *sreq = "4\n1\nk2\nv12\nk20\n";
    g_set[0] = 0;
    CHECK(bulk_set(sreq, (int)strlen(sreq), fset, NULL) == 0 && !strcmp(g_set, "k=v1;k2=;"), "bulk set: %s", g_set);
    CHECK(bulk_set("3\n", 2, fset, NULL) == -1, "odd pair count refused");
}

int main(void) {
    test_deltas();
    test_midi_in();
    test_midi_out();
    test_params();
    test_bulk();
    printf("%s: %d checks, %d failed\n", fails ? "HOST TESTS FAILED" : "HOST TESTS OK", checks, fails);
    return fails != 0;
}
