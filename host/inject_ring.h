/* schwung's /schwung-midi-inject ring (shadow_midi_inject_writer.h), drained
 * as hardware input so the dev tools that write it (inject-*.py,
 * schwung-midi-inject-ui.py) keep working. Its creator must initialise it,
 * and the shim that used to is not running, so movy-host takes that role. */
#ifndef MH_INJECT_RING_H
#define MH_INJECT_RING_H

#include <stdint.h>

void inject_ring_open(void);
/* Audio thread: the next packet, or 0. Bounded by the caller. */
int  inject_ring_pop(uint8_t pkt[4]);

#endif
