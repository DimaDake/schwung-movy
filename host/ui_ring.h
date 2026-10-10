/* shadow_ui's own input ring, /schwung-ui-midi, read the way shadow_ui reads
 * it (schwung's ui_midi_ring.h, compiled from the pin). The shim never writes
 * it here — there is no shim — but movy's dev tools do: inject-any.py,
 * inject-ui.py, dev-probe.sh -i and the harness's ui-agent all speak this
 * ring, so reading it keeps every one of them working on movy-host with no
 * flavour branch. It feeds the same single input as the SPI mailbox. */
#ifndef MH_UI_RING_H
#define MH_UI_RING_H

#include <stdint.h>

void ui_ring_open(void);
/* Audio thread. 1 = a packet, in arrival order. */
int  ui_ring_pop(uint8_t pkt[4]);

#endif
