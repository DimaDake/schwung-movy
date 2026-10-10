/* The engine (dsp.so) and the host_api_v1_t it is given.
 *
 * The audio thread brackets each frame's engine work with engine_frame_begin/
 * end; a (re)load swaps the instance under that same lock from another thread,
 * so render, on_midi and param service never see a half-built engine. */
#ifndef MH_VTABLE_H
#define MH_VTABLE_H

#include <stdint.h>
#include "param_queue.h"

void engine_set_mapped(uint8_t *spi_map);
/* Not on the audio thread: dlopen + create_instance. 1 on success. A reload
 * destroys the old instance first; its library stays mapped (dlclose under an
 * engine that may own threads is how a host crashes). */
int  engine_load(const char *dsp_path, const char *module_dir);
void engine_unload(void);
int  engine_loaded(void);

/* Audio thread only. */
void engine_frame_begin(void);
void engine_frame_end(void);
void engine_on_midi(const uint8_t *msg, int len);
int  engine_render(int16_t *interleaved, int frames);   /* 0 = no engine */
void engine_service(void *ctx, pq_req_t *r);            /* pq_service_fn */
/* The key of the last request serviced: names the param behind a slow frame. */
const char *engine_last_key(void);

#endif
