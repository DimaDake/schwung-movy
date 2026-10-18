/* A stand-in for movy-dsp that renders the way it does: ADDING into the
 * buffer it is handed (in overtake that buffer already holds Move's mix). */
#include <stddef.h>
#include "plugin_api_v1.h"

static int g_inst;
static void *create(const char *dir, const char *defaults) { (void)dir; (void)defaults; return &g_inst; }
/* The last on_midi's source rides the next block's samples (1 + source), so
 * the test can see what movy-host told the engine without a symbol of its own. */
static int g_src;
static void on_midi(void *inst, const uint8_t *msg, int len, int source) { (void)inst; (void)msg; (void)len; g_src = source; }
static void render(void *inst, int16_t *out, int frames) { (void)inst; for (int i = 0; i < frames * 2; i++) out[i] += 1 + g_src; g_src = 0; }
static plugin_api_v2_t api = { .api_version = 2, .create_instance = create, .on_midi = on_midi, .render_block = render };
plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) { (void)host; return &api; }

/* The engine's move_info export: a marker byte the test can recognise. */
int movy_move_info(void *out, size_t cap) { if (cap) *(unsigned char *)out = 0x4D; return 1; }
