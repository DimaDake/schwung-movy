#include <pthread.h>
#include <string.h>

#include "midi_out.h"
#include "spsc.h"

#define FIFO_CAP 512u

typedef struct { uint8_t pkt[4]; uint8_t pending; } led_t;

/* The UI side is guarded by g_mu; the audio thread only ever TRIES it and
 * skips the LED table for a frame when the UI holds it. */
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static led_t g_notes[128], g_ccs[128];
static int g_pending;
static spsc_t g_fifo;        /* UI → audio, non-LED packets */
static spsc_t g_audio_fifo;  /* engine's own sends, audio thread both ends */
static uint8_t g_pads[32];

void midi_out_reset(void) {
    pthread_mutex_lock(&g_mu);
    memset(g_notes, 0, sizeof g_notes);
    memset(g_ccs, 0, sizeof g_ccs);
    g_pending = 0;
    g_fifo.head = g_fifo.tail = g_audio_fifo.head = g_audio_fifo.tail = 0;
    memset(g_pads, 0, sizeof g_pads);
    pthread_mutex_unlock(&g_mu);
}

static int is_led(int cable, uint8_t status) {
    uint8_t t = status & 0xF0;
    return cable == 0 && (t == 0x90 || t == 0xB0);
}

int midi_out_send(int cable, const uint8_t *pkts, int len) {
    if (len <= 0 || (len & 3) != 0) return 0;
    /* All or nothing: a SysEx is a run of packets, and a prefix on the wire is
     * a different message (shadow_ui.c js_shadow_midi_send). LEDs never wait. */
    uint32_t fifo_pkts = 0;
    for (int i = 0; i < len; i += 4) if (!is_led(cable, pkts[i + 1])) fifo_pkts++;
    if (spsc_count(&g_fifo) + fifo_pkts > FIFO_CAP) return 0;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < len; i += 4) {
        uint8_t p[4] = { (uint8_t)((pkts[i] & 0x0F) | (cable << 4)), pkts[i + 1], pkts[i + 2], pkts[i + 3] };
        if (is_led(cable, p[1])) {
            led_t *slot = (p[1] & 0xF0) == 0x90 ? &g_notes[p[2] & 0x7F] : &g_ccs[p[2] & 0x7F];
            if (!slot->pending) g_pending++;
            memcpy(slot->pkt, p, 4);
            slot->pending = 1;
        } else {
            spsc_push(&g_fifo, p, FIFO_CAP);
        }
    }
    pthread_mutex_unlock(&g_mu);
    return 1;
}

int midi_out_send_audio(const uint8_t pkt[4]) { return spsc_push(&g_audio_fifo, pkt, FIFO_CAP); }

static int take_leds(led_t *tab, uint8_t out[][4], int n) {
    for (int i = 0; i < 128 && n < MIDI_OUT_PER_FRAME && g_pending > 0; i++) {
        if (!tab[i].pending) continue;
        memcpy(out[n++], tab[i].pkt, 4);
        tab[i].pending = 0;
        g_pending--;
        if (tab == g_notes && i >= 68 && i <= 99) g_pads[i - 68] = tab[i].pkt[3];
    }
    return n;
}

int midi_out_take(uint8_t out[MIDI_OUT_PER_FRAME][4]) {
    int n = 0;
    while (n < MIDI_OUT_PER_FRAME && spsc_pop(&g_audio_fifo, out[n])) n++;
    while (n < MIDI_OUT_PER_FRAME && spsc_pop(&g_fifo, out[n])) n++;
    if (n < MIDI_OUT_PER_FRAME && pthread_mutex_trylock(&g_mu) == 0) {
        /* Notes before CCs, ascending: the order shadow_ui's flushLedQueue
         * walks its two maps in. */
        n = take_leds(g_notes, out, n);
        n = take_leds(g_ccs, out, n);
        pthread_mutex_unlock(&g_mu);
    }
    return n;
}

void midi_out_pad_snapshot(uint8_t out[32]) {
    for (int i = 0; i < 32; i++) out[i] = __atomic_load_n(&g_pads[i], __ATOMIC_RELAXED);
}
