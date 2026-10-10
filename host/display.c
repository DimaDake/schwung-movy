#include <fcntl.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "display.h"
#include "js_display.h"
#include "lib/schwung_spi_lib.h"
#include "log.h"
#include "spi.h"

typedef struct { uint32_t seq; uint8_t px[SCHWUNG_DISPLAY_SIZE]; } frame_t;

static frame_t g_published;   /* UI writes, audio reads */
static frame_t g_glass;       /* audio writes, testbus reads */
static uint8_t g_serving[SCHWUNG_DISPLAY_SIZE];
static uint8_t *g_live, *g_shot;

static uint8_t *map_frame(const char *name, const char *who) {
    int fd = shm_open(name, O_RDWR | O_CREAT, 0666);
    if (fd < 0) { mh_log("display: no %s (%s)", name, who); return NULL; }
    /* Whichever uid creates it, the other must be able to open it next. */
    fchmod(fd, 0666);
    struct stat st;
    if (fstat(fd, &st) == 0 && st.st_size < SCHWUNG_DISPLAY_SIZE && ftruncate(fd, SCHWUNG_DISPLAY_SIZE) != 0)
        mh_log("display: ftruncate %s failed", name);
    void *p = mmap(NULL, SCHWUNG_DISPLAY_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    return p == MAP_FAILED ? NULL : p;
}

/* Two copies of the frame, for the two readers the dev tools already have:
 * display-server streams schwung-display-live (capture-screen.mjs), and
 * grab-screen.mjs reads schwung-display, shadow_ui's own frame under the
 * shim. Nothing else writes either while movy-host runs. */
void display_init(void) {
    g_live = map_frame("/schwung-display-live", "display-server will not stream");
    g_shot = map_frame("/schwung-display", "grab-screen.mjs will read a stale frame");
}

/* Seqlock writer: odd while the bytes are moving. */
static void frame_write(frame_t *f, const uint8_t *px) {
    __atomic_add_fetch(&f->seq, 1, __ATOMIC_RELEASE);
    __atomic_thread_fence(__ATOMIC_SEQ_CST);
    memcpy(f->px, px, SCHWUNG_DISPLAY_SIZE);
    __atomic_add_fetch(&f->seq, 1, __ATOMIC_RELEASE);
}

/* Seqlock reader that never spins: on a torn read it keeps what it had. */
static int frame_read(frame_t *f, uint8_t *out) {
    uint32_t s1 = __atomic_load_n(&f->seq, __ATOMIC_ACQUIRE);
    if (s1 & 1) return 0;
    uint8_t tmp[SCHWUNG_DISPLAY_SIZE];
    memcpy(tmp, f->px, SCHWUNG_DISPLAY_SIZE);
    __atomic_thread_fence(__ATOMIC_ACQUIRE);
    if (__atomic_load_n(&f->seq, __ATOMIC_RELAXED) != s1) return 0;
    memcpy(out, tmp, SCHWUNG_DISPLAY_SIZE);
    return 1;
}

void display_publish(int tick) {
    if (!js_display_screen_dirty && tick % 30 != 0) return;
    uint8_t packed[SCHWUNG_DISPLAY_SIZE];
    js_display_pack(packed);
    js_display_screen_dirty = 0;
    frame_write(&g_published, packed);
    if (g_live) memcpy(g_live, packed, SCHWUNG_DISPLAY_SIZE);
    if (g_shot) memcpy(g_shot, packed, SCHWUNG_DISPLAY_SIZE);
}

void display_serve(uint8_t *map) {
    uint32_t idx;
    memcpy(&idx, map + SCHWUNG_OFF_IN_DISP_STAT, 4);
    if (idx == 1 && frame_read(&g_published, g_serving)) frame_write(&g_glass, g_serving);
    spi_serve_display(map, g_serving);
}

void display_on_glass(uint8_t out[1024]) {
    while (!frame_read(&g_glass, out)) { /* testbus thread: a retry is fine */ }
}
