#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "inject_ring.h"
#include "log.h"
#include "shadow_midi_inject_writer.h"

static shadow_midi_inject_t *g_ring;

void inject_ring_open(void) {
    int fd = shm_open(SHM_SHADOW_MIDI_INJECT, O_RDWR | O_CREAT, 0666);
    if (fd < 0) { mh_log("inject ring: shm_open failed"); return; }
    /* Whichever uid creates it, the other must be able to open it next. */
    fchmod(fd, 0666);
    if (ftruncate(fd, sizeof *g_ring) != 0) { close(fd); mh_log("inject ring: ftruncate failed"); return; }
    void *p = mmap(NULL, sizeof *g_ring, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) return;
    /* Whatever a previous shim left is stale: its consumer is gone. */
    shadow_midi_inject_init(p);
    g_ring = p;
}

int inject_ring_pop(uint8_t pkt[4]) {
    if (!g_ring || !shadow_midi_inject_peek(g_ring, pkt)) return 0;
    shadow_midi_inject_pop(g_ring);
    return 1;
}
