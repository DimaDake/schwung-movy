#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>

#include "lib/schwung_spi_lib.h"
#include "spi.h"

#define IOC(nr) _IOC(_IOC_NONE, 0, (nr), 0)

int spi_open(mh_spi_t *s) {
    s->fd = open(SCHWUNG_SPI_DEVICE, O_RDWR | O_CLOEXEC);
    if (s->fd < 0) return -errno;
    s->map = mmap(NULL, SCHWUNG_PAGE_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, s->fd, 0);
    if (s->map == MAP_FAILED) { int e = errno; close(s->fd); s->fd = -1; return -e; }
    memset(s->map, 0, SCHWUNG_PAGE_SIZE);
    ioctl(s->fd, IOC(SCHWUNG_IOCTL_SET_SPEED), SCHWUNG_SPI_FREQ);
    /* A MIDI system reset ends the XMOS power-on LED show (boot-select.c,
     * bisected on hardware); nothing else in Move's boot traffic does. */
    s->map[0] = 0x0F;
    s->map[1] = 0xFF;
    spi_pump(s);
    memset(s->map, 0, 4);
    return 0;
}

void spi_pump(mh_spi_t *s) { ioctl(s->fd, IOC(SCHWUNG_IOCTL_WAIT_SEND_SIZE), 0x300); }

void spi_serve_display(uint8_t *map, const uint8_t packed[1024]) {
    uint32_t idx;
    memcpy(&idx, map + SCHWUNG_OFF_IN_DISP_STAT, 4);
    if (idx < 1 || idx > 6) return;
    int off = (int)(idx - 1) * SCHWUNG_OUT_DISP_CHUNK_LEN;
    int len = idx == 6 ? SCHWUNG_DISPLAY_SIZE - off : SCHWUNG_OUT_DISP_CHUNK_LEN;
    memcpy(map + SCHWUNG_OFF_OUT_DISP_STAT, &idx, 4);
    memcpy(map + SCHWUNG_OFF_OUT_DISP_DATA, packed + off, (size_t)len);
}

void spi_close(mh_spi_t *s) {
    if (s->fd < 0) return;
    static const uint8_t blank[1024];
    memset(s->map + SCHWUNG_OFF_OUT_AUDIO, 0, SCHWUNG_AUDIO_FRAMES * 4);
    memset(s->map, 0, SCHWUNG_MIDI_OUT_MAX * 4);
    /* ~2 full request cycles of zeros so Move does not inherit our pixels. */
    for (int i = 0; i < 16; i++) { spi_pump(s); spi_serve_display(s->map, blank); }
    memset(s->map + SCHWUNG_OFF_OUT_DISP_STAT, 0, 4);
    munmap(s->map, SCHWUNG_PAGE_SIZE);
    close(s->fd);
    s->fd = -1;
}
