#include "deltas.h"

/* input_filter.mjs decodeDelta. */
int delta_decode(int v) {
    if (v >= 1 && v <= 63) return v;
    if (v >= 65 && v <= 127) return -(128 - v);
    return 0;
}

int delta_encode(int d) {
    if (d > 0) return d > 63 ? 63 : d;
    int v = 128 + d;
    return v < 65 ? 65 : v;
}

int deltas_absorb(deltas_t *d, const uint8_t msg[3]) {
    if ((msg[0] & 0xF0) != 0xB0) return 0;
    if (msg[1] >= DELTAS_KNOB_CC && msg[1] < DELTAS_KNOB_CC + 8) {
        d->knob[msg[1] - DELTAS_KNOB_CC] += delta_decode(msg[2]);
        return 1;
    }
    if (msg[1] == DELTAS_JOG_CC) {
        d->jog += delta_decode(msg[2]);
        return 1;
    }
    return 0;
}

int deltas_flush(deltas_t *d, uint8_t out[9][3]) {
    int n = 0;
    for (int k = 0; k < 8; k++) {
        if (d->knob[k] == 0) continue;
        out[n][0] = 0xB0;
        out[n][1] = (uint8_t)(DELTAS_KNOB_CC + k);
        out[n][2] = (uint8_t)delta_encode(d->knob[k]);
        d->knob[k] = 0;
        n++;
    }
    if (d->jog != 0) {
        out[n][0] = 0xB0;
        out[n][1] = DELTAS_JOG_CC;
        out[n][2] = (uint8_t)delta_encode(d->jog);
        d->jog = 0;
        n++;
    }
    return n;
}
