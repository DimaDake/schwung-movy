#include <fcntl.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "log.h"
#include "shadow_constants.h"
#include "ui_midi_ring.h"
#include "ui_ring.h"

static uint8_t *g_ring;
static int g_rd;

void ui_ring_open(void) {
    int fd = shm_open(SHM_SHADOW_UI_MIDI, O_RDWR | O_CREAT, 0666);
    if (fd < 0) { mh_log("ui ring: shm_open failed (dev inject tools will not reach movy)"); return; }
    fchmod(fd, 0666);   /* tools write it as ableton, a dev stack may run us as root */
    if (ftruncate(fd, SHADOW_UI_MIDI_BYTES) != 0) { close(fd); mh_log("ui ring: ftruncate failed"); return; }
    void *p = mmap(NULL, SHADOW_UI_MIDI_BYTES, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) return;
    /* What is there was meant for a shadow_ui that is gone (it clears on
     * attach too). */
    memset(p, 0, SHADOW_UI_MIDI_BYTES);
    g_ring = p;
}

int ui_ring_pop(uint8_t pkt[4]) {
    if (!g_ring) return 0;
    int i = ui_midi_ring_next(g_ring, SHADOW_UI_MIDI_BYTES, &g_rd);
    if (i < 0) return 0;
    ui_midi_ring_advance(&g_rd, SHADOW_UI_MIDI_BYTES);
    pkt[0] = __atomic_load_n(&g_ring[i], __ATOMIC_ACQUIRE);
    pkt[1] = g_ring[i + 1];
    pkt[2] = g_ring[i + 2];
    pkt[3] = g_ring[i + 3];
    __atomic_store_n(&g_ring[i], 0, __ATOMIC_RELEASE);
    return 1;
}
