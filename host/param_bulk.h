/* The overtake bulk param codec (schwung_shim.c shim_handle_param_bulk), so
 * movy's src/track/bulk.ts payloads mean the same thing here: a count line,
 * then length-prefixed records — keys for a get, key/value pairs for a set. */
#ifndef MH_PARAM_BULK_H
#define MH_PARAM_BULK_H

typedef int  (*bulk_get_fn)(void *ctx, const char *key, char *buf, int cap);
typedef void (*bulk_set_fn)(void *ctx, const char *key, const char *val);

/* Returns the answer length written to out (get) or 0 (set); -1 malformed. */
int bulk_get(const char *req, int req_len, char *out, int cap, bulk_get_fn get, void *ctx);
int bulk_set(const char *req, int req_len, bulk_set_fn set, void *ctx);

#endif
