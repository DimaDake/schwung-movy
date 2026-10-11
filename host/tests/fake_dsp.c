/* A stand-in for movy-dsp that renders the way it does: ADDING into the
 * buffer it is handed (in overtake that buffer already holds Move's mix). */
#include <stddef.h>
#include "plugin_api_v1.h"

static int g_inst;
static void *create(const char *dir, const char *defaults) { (void)dir; (void)defaults; return &g_inst; }
static void render(void *inst, int16_t *out, int frames) { (void)inst; for (int i = 0; i < frames * 2; i++) out[i] += 1; }
static plugin_api_v2_t api = { .api_version = 2, .create_instance = create, .render_block = render };
plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) { (void)host; return &api; }
