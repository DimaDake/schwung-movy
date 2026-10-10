/* movy-host — the standalone flavour's C host (plans/2026-10-09-standalone-
 * migration.md, WP6). It owns the device the way shim + shadow_ui do for the
 * overtake flavour, and runs the SAME ui.js and dsp.so.
 *
 * Threads: main (QuickJS UI, ui.c), movy-audio (SPI frame loop, audio.c) and,
 * when asked for, movy-testbus (testbus.c). The engine is only ever called
 * from movy-audio, or with the audio thread locked out (vtable.c), because
 * plugin_api_v2 promises a module that render and set/get never overlap. */
#ifndef MOVY_HOST_H
#define MOVY_HOST_H

#include <stdint.h>

#define MH_VERSION "0.1.0"
#define MH_SCHWUNG_DIR "/data/UserData/schwung"
#define MH_CHAIN_DIR MH_SCHWUNG_DIR "/modules/chain"

/* Process-wide flags. Written by one thread, read by others: plain atomics. */
extern volatile int g_mh_quit;        /* SIGTERM, EXIT, host_exit_module */
extern volatile int g_mh_ui_running;  /* ui.js loaded and ticking */
extern char g_mh_module_dir[256];     /* where movy-host, ui.js, dsp.so sit */

uint64_t mh_now_ms(void);
uint64_t mh_now_us(void);

#endif
