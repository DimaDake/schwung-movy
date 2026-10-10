#include <dlfcn.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "log.h"
#include "midi_out.h"
#include "param_bulk.h"
#include "plugin_api_v1.h"
#include "lib/schwung_spi_lib.h"
#include "vtable.h"

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static plugin_api_v2_t *g_api;
static void *g_inst;

static void host_log(const char *msg) { mh_log_src("movy-dsp", "%s", msg); }

/* Schwung slots do not exist here, and the engine skips this send under
 * hostmode=standalone (WP2); a stray call is refused, never queued. */
static int host_midi_internal(const uint8_t *msg, int len) { (void)msg; (void)len; return 0; }

static int host_midi_external(const uint8_t *msg, int len) {
    int sent = 0;
    for (int i = 0; i + 4 <= len; i += 4) {
        uint8_t p[4] = { (uint8_t)((msg[i] & 0x0F) | 0x20), msg[i + 1], msg[i + 2], msg[i + 3] };
        if (!midi_out_send_audio(p)) break;
        sent += 4;
    }
    return sent;
}

/* Clock fields stay NULL: the engine answers them for its chains from its own
 * transport (WP2, host_vtable.rs), whatever the host passes. */
static host_api_v1_t g_host = {
    .api_version = MOVE_PLUGIN_API_VERSION,
    .sample_rate = SCHWUNG_SAMPLE_RATE,
    .frames_per_block = SCHWUNG_AUDIO_FRAMES,
    .audio_out_offset = SCHWUNG_OFF_OUT_AUDIO,
    .audio_in_offset = SCHWUNG_OFF_IN_AUDIO,
    .log = host_log,
    .midi_send_internal = host_midi_internal,
    .midi_send_external = host_midi_external,
};

void engine_set_mapped(uint8_t *spi_map) { g_host.mapped_memory = spi_map; }

static void swap(plugin_api_v2_t *api, void *inst, plugin_api_v2_t **old_api, void **old_inst) {
    pthread_mutex_lock(&g_mu);
    *old_api = g_api;
    *old_inst = g_inst;
    g_api = api;
    g_inst = inst;
    pthread_mutex_unlock(&g_mu);
}

void engine_unload(void) {
    plugin_api_v2_t *api;
    void *inst;
    swap(NULL, NULL, &api, &inst);
    if (api && inst && api->destroy_instance) api->destroy_instance(inst);
}

int engine_load(const char *dsp_path, const char *module_dir) {
    engine_unload();
    void *h = dlopen(dsp_path, RTLD_NOW | RTLD_LOCAL);
    if (!h) { mh_log("engine: dlopen %s failed: %s", dsp_path, dlerror()); return 0; }
    move_plugin_init_v2_fn init = (move_plugin_init_v2_fn)dlsym(h, MOVE_PLUGIN_INIT_V2_SYMBOL);
    plugin_api_v2_t *api = init ? init(&g_host) : NULL;
    void *inst = api && api->create_instance ? api->create_instance(module_dir, NULL) : NULL;
    if (!inst) { mh_log("engine: %s gave no instance (init=%p api=%p)", dsp_path, (void *)init, (void *)api); return 0; }
    plugin_api_v2_t *oa;
    void *oi;
    swap(api, inst, &oa, &oi);
    mh_log("engine: loaded %s (dir %s)", dsp_path, module_dir);
    return 1;
}

int engine_loaded(void) { return __atomic_load_n(&g_inst, __ATOMIC_ACQUIRE) != NULL; }

void engine_frame_begin(void) { pthread_mutex_lock(&g_mu); }
void engine_frame_end(void) { pthread_mutex_unlock(&g_mu); }

void engine_on_midi(const uint8_t *msg, int len) {
    if (g_api && g_inst && g_api->on_midi) g_api->on_midi(g_inst, msg, len, MOVE_MIDI_SOURCE_INTERNAL);
}

int engine_render(int16_t *buf, int frames) {
    if (!g_api || !g_inst || !g_api->render_block) return 0;
    g_api->render_block(g_inst, buf, frames);
    return 1;
}

static int get_one(void *ctx, const char *key, char *buf, int cap) {
    (void)ctx;
    return g_api->get_param ? g_api->get_param(g_inst, key, buf, cap) : -1;
}

static void set_one(void *ctx, const char *key, const char *val) {
    (void)ctx;
    if (g_api->set_param) g_api->set_param(g_inst, key, val);
}

static char g_last_key[PQ_KEY_CAP];
const char *engine_last_key(void) { return g_last_key; }

/* Called inside engine_frame_begin/end, so g_api cannot change under it. */
void engine_service(void *ctx, pq_req_t *r) {
    (void)ctx;
    r->result = -1;
    snprintf(g_last_key, sizeof g_last_key, "%s",
             r->kind == PQ_BULK_GET ? "(bulk get)" : r->kind == PQ_BULK_SET ? "(bulk set)" : r->key);
    if (!g_api || !g_inst) return;
    switch (r->kind) {
    case PQ_GET: r->result = get_one(NULL, r->key, r->value, PQ_VALUE_CAP); break;
    case PQ_SET: set_one(NULL, r->key, r->value); r->result = 0; break;
    case PQ_BULK_SET: r->result = bulk_set(r->value, (int)strlen(r->value), set_one, NULL); break;
    case PQ_BULK_GET: {
        static char req[PQ_VALUE_CAP];
        size_t n = strnlen(r->value, PQ_VALUE_CAP - 1);
        memcpy(req, r->value, n);
        r->result = bulk_get(req, (int)n, r->value, PQ_VALUE_CAP, get_one, NULL);
        break;
    }
    }
}
