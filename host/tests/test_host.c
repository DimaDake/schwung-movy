/* Unit tests for movy-host's pure modules (input, output, params). Built
 * natively and in a Linux container (scripts/test-host-linux.sh) — macOS and
 * glibc disagree on enough opaque types that one is not proof of the other. */
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "deltas.h"
#include "frame_clock.h"
#include "midi_in.h"
#include "midi_out.h"
#include "param_bulk.h"
#include "placement.h"
#include "param_queue.h"
#include "status_snap.h"
#include "surface_keys.h"

volatile int g_mh_quit;

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

uint64_t mh_now_ms(void) { return 0; }
void mh_log(const char *fmt, ...) { (void)fmt; }

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
    /* Cable 14 is Move's "system" cable: the power button's companion CC rides it,
     * and as an ordinary CC it dismissed the power dialog the button had just opened. */
    uint8_t sys[4] = { 0xEB, 0xB0, 0x3A, 0x7F };
    CHECK(midi_in_feed(sys, 0) == 0, "cable 14 does not go to the engine");
    CHECK(!midi_in_ui_pop(p), "cable 14 never reaches the UI");

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

/* WP10: the UI asks "is everything I sent up to here in the engine?" by
 * comparing a snapshot's `served` stamp with the `submitted` count it took. */
static void test_queue_marks(void) {
    pq_service(fake_service, NULL, 64);
    uint64_t sub0 = pq_submitted(), srv0 = pq_served();
    CHECK(sub0 == srv0, "drained: served catches submitted (%llu/%llu)", (unsigned long long)sub0, (unsigned long long)srv0);
    pq_set("m1", "1", 0);
    pq_set("m2", "2", 0);
    CHECK(pq_submitted() == sub0 + 2, "each queued request counts as submitted");
    CHECK(pq_served() == srv0, "nothing is served before the audio thread runs");
    pq_service(fake_service, NULL, 1);
    CHECK(pq_served() == srv0 + 1, "served counts in FIFO order, one at a time");
    pq_service(fake_service, NULL, 8);
    CHECK(pq_served() == sub0 + 2, "and reaches the mark once all are in");

    /* A bulk set nobody waits for: returns at once, applies on service. */
    g_log[0] = 0;
    CHECK(pq_bulk(PQ_BULK_SET, "2\n1\nk1\nv", NULL, 0, 0) == 0, "a non-waiting bulk set returns at once");
    CHECK(g_log[0] == 0, "and has not been applied yet");
    pq_service(fake_service, NULL, 8);
    CHECK(g_log[0] != 0, "it is applied on the next service");
}

static const char *pattern(int i, char *buf, int *len) {
    char c = (char)('A' + i % 3);
    *len = 500 + (i % 3) * 700;
    memset(buf, c, (size_t)*len);
    buf[*len] = 0;
    return buf;
}
/* Stamps of their own, so the snapshot published before the race is never
 * mistaken for one of the writer's. */
#define WRITER_BASE 1000000u
static volatile int g_writer_done;
static void *snap_writer(void *arg) {
    static char buf[4096];
    for (int i = 1; i <= 20000; i++) { int n; pattern(i, buf, &n); snap_publish(buf, n, WRITER_BASE + (uint64_t)i); }
    g_writer_done = 1;
    return NULL;
}

static void test_status_snap(void) {
    char out[STATUS_SNAP_CAP];
    uint32_t seq = 99;
    uint64_t served = 99;
    CHECK(snap_seq() == 0 && snap_read(out, sizeof out, &seq, &served) == -1, "nothing published reads as none");
    CHECK(snap_publish("play=1", 6, 5) == 1, "a publish is taken");
    int n = snap_read(out, sizeof out, &seq, &served);
    CHECK(n == 6 && !strcmp(out, "play=1") && seq == 1 && served == 5, "read back: %d '%s' seq=%u served=%llu",
          n, out, seq, (unsigned long long)served);

    static char big[STATUS_SNAP_CAP + 10];
    memset(big, 'x', sizeof big - 1);
    CHECK(snap_publish(big, (int)sizeof big - 1, 6) == 0, "an over-long status is refused, never truncated");
    n = snap_read(out, sizeof out, &seq, &served);
    CHECK(n == 6 && seq == 1, "and the last good snapshot stands");

    /* A reader racing a writer never sees a torn snapshot: every read is one
     * whole publish, and the stamps never go backwards. */
    g_writer_done = 0;
    pthread_t t;
    pthread_create(&t, NULL, snap_writer, NULL);
    int torn = 0, back = 0, reads = 0;
    uint64_t last = 0;
    while (!g_writer_done || reads < 1000) {
        n = snap_read(out, sizeof out, &seq, &served);
        if (n < 0) continue;
        reads++;
        int want;
        char ref[4096];
        if (served > WRITER_BASE) {
            pattern((int)(served - WRITER_BASE), ref, &want);
            if (n != want || memcmp(out, ref, (size_t)n) != 0) torn++;
        }
        if (served < last) back++;
        last = served;
        if (g_writer_done && reads >= 1000) break;
    }
    pthread_join(t, NULL);
    CHECK(torn == 0, "no torn snapshot in %d reads (%d torn)", reads, torn);
    CHECK(back == 0, "served never goes backwards (%d)", back);
    CHECK(snap_seq() >= 20001, "every publish counted (%u)", snap_seq());
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

static void feed(uint8_t a, uint8_t b, uint8_t c, uint8_t d) { uint8_t p[4] = { a, b, c, d }; surface_keys_feed(p, 1000); }
static void power_sysex(uint8_t cmd) {
    feed(0x04, 0xF0, 0x00, 0x21); feed(0x04, 0x1D, 0x01, 0x01); feed(0x04, cmd, 0x07, 0x7F); feed(0x06, 0x00, 0xF7, 0x00);
}

static void test_surface_keys(void) {
    surface_keys_reset();
    power_sysex(0x3A);
    CHECK(surface_power_take() == 1, "a power-button hold is one event");
    CHECK(surface_power_take() == 0, "taken once");
    CHECK(surface_power_ack_take() == 1 && surface_power_ack_take() == 0, "each power event is owed exactly one reply");
    power_sysex(0x3B);   /* the LED SysEx's command byte: not the button */
    CHECK(surface_power_take() == 0, "another SysEx with the same head is not the button");
    CHECK(surface_power_ack_take() == 0, "and is not answered");
    /* Captured on an idle device: the battery report (99%) shares the button's 3A command. */
    feed(0x04, 0xF0, 0x00, 0x21); feed(0x04, 0x1D, 0x01, 0x01); feed(0x04, 0x3A, 0x00, 0x63); feed(0x06, 0x00, 0xF7, 0x00);
    CHECK(surface_power_take() == 0, "a battery report (3A id 00) is not a button press");
    CHECK(surface_power_ack_take() == 1, "but is still answered");
    feed(0x04, 0xF0, 0x00, 0x21); feed(0x0B, 0xB0, 49, 127);   /* broken by a CC */
    feed(0x04, 0x1D, 0x01, 0x01); feed(0x04, 0x3A, 0x07, 0x7F); feed(0x06, 0x00, 0xF7, 0x00);
    CHECK(surface_power_take() == 0, "a run broken by another event does not count");
    feed(0x04, 0xF0, 0x00, 0x21); power_sysex(0x3A);
    CHECK(surface_power_take() == 1, "a stray lead packet does not swallow the real run");
    uint8_t ext[4] = { 0x24, 0xF0, 0x00, 0x21 };
    surface_keys_feed(ext, 1000);
    feed(0x04, 0x1D, 0x01, 0x01);
    CHECK(surface_power_take() == 0, "cable 2 (USB MIDI) is never the button");

    surface_keys_reset();
    g_mh_quit = 0;
    feed(0x0B, 0xB0, 3, 127);
    CHECK(!g_mh_quit && !surface_fallback_at(), "a jog click alone is not the escape");
    feed(0x0B, 0xB0, 49, 127); feed(0x0B, 0xB0, 3, 127);
    CHECK(!g_mh_quit, "Shift + jog click is not the escape (no volume touch)");
    feed(0x09, 0x90, 8, 127); feed(0x0B, 0xB0, 3, 127);
    CHECK(g_mh_quit && surface_fallback_at() == 1000, "Shift + volume touch + jog click quits");
    surface_keys_reset();
    g_mh_quit = 0;
    feed(0x09, 0x90, 8, 127); feed(0x0B, 0xB0, 49, 127); feed(0x09, 0x90, 8, 0); feed(0x0B, 0xB0, 3, 127);
    CHECK(!g_mh_quit, "a released touch is not held");
    g_mh_quit = 0;
}

static void test_frame_clock(void) {
    CHECK(!frame_late(0, 10000), "the first transfer has nothing to be late against");
    CHECK(!frame_late(1000, 1000 + MH_FRAME_US), "one frame apart is on time");
    CHECK(!frame_late(1000, 1000 + MH_FRAME_US + 49), "the jitter measured on device is on time");
    CHECK(frame_late(1000, 1000 + 3364), "an overrun's gap (work + DMA past the frame) is late");
}

static void test_placement(void) {
    CHECK(placement_should_move(MH_AUDIO_CORE_MASK, 0), "a task inherited onto the audio core moves");
    CHECK(!placement_should_move(MH_AUDIO_CORE_MASK, 1), "the audio thread stays");
    CHECK(!placement_should_move(0xF, 0), "a task free to use every core is the scheduler's");
    CHECK(!placement_should_move(MH_OFF_AUDIO_MASK, 0), "a task already off the audio core stays");
}

int main(void) {
    test_deltas();
    test_midi_in();
    test_midi_out();
    test_params();
    test_bulk();
    test_queue_marks();
    test_status_snap();
    test_surface_keys();
    test_frame_clock();
    test_placement();
    printf("%s: %d checks, %d failed\n", fails ? "HOST TESTS FAILED" : "HOST TESTS OK", checks, fails);
    return fails != 0;
}
