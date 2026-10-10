/* The 128x64 frame from QuickJS (js_display) to the glass.
 *
 * The UI thread packs and publishes; the audio thread, which answers the
 * XMOS's slice requests, takes a whole published frame at slice 1 so one
 * transfer never mixes two frames. display-server streams the same packed
 * frame from /dev/shm/schwung-display-live (WP0 run C: format unchanged). */
#ifndef MH_DISPLAY_H
#define MH_DISPLAY_H

#include <stdint.h>

void display_init(void);
/* UI thread, once per tick: packs when js_display says the screen changed
 * (and every 30 ticks regardless, as shadow_ui does). */
void display_publish(int tick);
/* Audio thread, once per frame. */
void display_serve(uint8_t *spi_map);
/* The frame last sent over SPI (testbus FB). */
void display_on_glass(uint8_t out[1024]);

#endif
