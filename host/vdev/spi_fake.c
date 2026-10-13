/* The virtual device's SPI (plan WP12): spi.h with no XMOS behind it.
 *
 * The mailbox is a file the same 4 KiB page is mapped from, so a process
 * outside movy-host can play the XMOS's other half (feed MIDI_IN, read the
 * audio out). The frame clock is CLOCK_MONOTONIC on absolute deadlines: a pump
 * that comes back late does not push every later frame back, the same way the
 * hardware keeps its own clock and only the late transfer runs late
 * (frame_clock.h). Display slices are asked for in the XMOS's order, 1..6.
 *
 * Built in place of spi.c by `MOVY_VDEV=1 build-host.sh`, never into the
 * device binary — and it refuses to run where a real /dev/ablspi0.0 exists,
 * because a movy-host that paces itself while Move drives the real SPI would
 * look alive and make no sound. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

#include "frame_clock.h"
#include "lib/schwung_spi_lib.h"
#include "log.h"
#include "spi.h"
#include "vdev/spi_fake.h"

static struct timespec g_next;
static uint32_t g_disp_idx;

const char *vspi_path(void) {
    const char *p = getenv("MOVY_VSPI");
    return p && *p ? p : VSPI_DEFAULT_PATH;
}

int spi_open(mh_spi_t *s) {
    if (access(SCHWUNG_SPI_DEVICE, F_OK) == 0 && !getenv("MOVY_VSPI_ON_DEVICE")) {
        mh_log("spi: this is the VIRTUAL device's movy-host, and %s exists; refusing", SCHWUNG_SPI_DEVICE);
        return -EPERM;
    }
    s->fd = open(vspi_path(), O_RDWR | O_CREAT | O_CLOEXEC, 0666);
    if (s->fd < 0) return -errno;
    if (ftruncate(s->fd, SCHWUNG_PAGE_SIZE) != 0) { int e = errno; close(s->fd); s->fd = -1; return -e; }
    s->map = mmap(NULL, SCHWUNG_PAGE_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, s->fd, 0);
    if (s->map == MAP_FAILED) { int e = errno; close(s->fd); s->fd = -1; return -e; }
    memset(s->map, 0, SCHWUNG_PAGE_SIZE);
    clock_gettime(CLOCK_MONOTONIC, &g_next);
    g_disp_idx = 0;
    mh_log("spi: virtual mailbox %s, %u us frames", vspi_path(), MH_FRAME_US);
    return 0;
}

static int16_t block_peak(const uint8_t *map) {
    const int16_t *a = (const int16_t *)(map + SCHWUNG_OFF_OUT_AUDIO);
    int peak = 0;
    for (int i = 0; i < SCHWUNG_AUDIO_FRAMES * 2; i++) { int v = abs(a[i]); if (v > peak) peak = v; }
    return (int16_t)(peak > 32767 ? 32767 : peak);
}

/* What the transfer hands the XMOS, then the wait for the next boundary. */
void spi_pump(mh_spi_t *s) {
    uint64_t frames;
    memcpy(&frames, s->map + VSPI_OFF_FRAMES, 8);
    frames++;
    int16_t peak = block_peak(s->map);
    memcpy(s->map + VSPI_OFF_PEAK, &peak, 2);
    __atomic_store_n((uint64_t *)(s->map + VSPI_OFF_FRAMES), frames, __ATOMIC_RELEASE);

    g_next.tv_nsec += (long)MH_FRAME_US * 1000;
    if (g_next.tv_nsec >= 1000000000L) { g_next.tv_sec++; g_next.tv_nsec -= 1000000000L; }
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    /* More than a frame behind (a stop in a debugger, a loaded VM): the
     * hardware would not hand back the frames it lost, so neither do we. */
    if (now.tv_sec > g_next.tv_sec + 1) g_next = now;
    /* Relative sleeps to an absolute deadline: macOS, where the unit tests
     * also run, has no clock_nanosleep. */
    for (;;) {
        long ns = (g_next.tv_sec - now.tv_sec) * 1000000000L + (g_next.tv_nsec - now.tv_nsec);
        if (ns <= 0) break;
        struct timespec d = { ns / 1000000000L, ns % 1000000000L };
        nanosleep(&d, NULL);
        clock_gettime(CLOCK_MONOTONIC, &now);
    }

    g_disp_idx = g_disp_idx % 6 + 1;
    memcpy(s->map + SCHWUNG_OFF_IN_DISP_STAT, &g_disp_idx, 4);
}

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
    munmap(s->map, SCHWUNG_PAGE_SIZE);
    close(s->fd);
    s->fd = -1;
}
