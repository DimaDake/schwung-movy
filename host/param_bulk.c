#include <stdio.h>
#include <string.h>

#include "param_bulk.h"
#include "param_queue.h"

/* schwung_shim.c SHADOW_BULK_MAX_ITEMS: bulk.ts chunks to fit it. */
#define BULK_MAX_ITEMS 64

/* Runs on the audio thread only (pq_service), so one scratch value buffer
 * serves every call without a 128 KiB allocation per frame. */
static char g_val[PQ_VALUE_CAP];

static int read_count(const char **pp, const char *end) {
    const char *p = *pp;
    long n = 0;
    int any = 0;
    while (p < end && *p >= '0' && *p <= '9') { n = n * 10 + (*p - '0'); p++; any = 1; if (n > 1 << 24) return -1; }
    if (!any || p >= end || *p != '\n') return -1;
    *pp = p + 1;
    return (int)n;
}

static const char *next_rec(const char **pp, const char *end, int *len) {
    int n = read_count(pp, end);
    if (n < 0 || *pp + n > end) return NULL;
    const char *r = *pp;
    *pp += n;
    *len = n;
    return r;
}

static int put_rec(char *out, int off, int cap, const char *bytes, int len) {
    int hdr = snprintf(out + off, (size_t)(cap - off), "%d\n", len);
    if (hdr <= 0 || off + hdr + len > cap) return -1;
    memcpy(out + off + hdr, bytes, (size_t)len);
    return off + hdr + len;
}

int bulk_get(const char *req, int req_len, char *out, int cap, bulk_get_fn get, void *ctx) {
    const char *p = req, *end = req + req_len;
    int count = read_count(&p, end);
    if (count < 0 || count > BULK_MAX_ITEMS) return -1;
    int off = snprintf(out, (size_t)cap, "%d\n", count);
    char key[PQ_KEY_CAP];
    char *val = g_val;
    for (int i = 0; i < count && off >= 0; i++) {
        int klen = 0, vlen = 0;
        const char *k = next_rec(&p, end, &klen);
        if (k && klen > 0 && klen < (int)sizeof key) {
            memcpy(key, k, (size_t)klen);
            key[klen] = '\0';
            int r = get(ctx, key, val, PQ_VALUE_CAP);
            if (r > 0) vlen = r >= PQ_VALUE_CAP ? PQ_VALUE_CAP - 1 : r;
        }
        off = put_rec(out, off, cap, val, vlen);
    }
    if (off >= 0 && off < cap) out[off] = '\0';
    return off;
}

int bulk_set(const char *req, int req_len, bulk_set_fn set, void *ctx) {
    const char *p = req, *end = req + req_len;
    int count = read_count(&p, end);
    if (count < 0 || count > BULK_MAX_ITEMS || (count & 1)) return -1;
    char key[PQ_KEY_CAP];
    char *val = g_val;
    for (int i = 0; i + 1 < count; i += 2) {
        int klen = 0, vlen = 0;
        const char *k = next_rec(&p, end, &klen);
        const char *v = k ? next_rec(&p, end, &vlen) : NULL;
        if (!v) break;
        if (klen <= 0 || klen >= (int)sizeof key || vlen >= PQ_VALUE_CAP) continue;
        memcpy(key, k, (size_t)klen);
        key[klen] = '\0';
        memcpy(val, v, (size_t)vlen);
        val[vlen] = '\0';
        set(ctx, key, val);
    }
    return 0;
}
