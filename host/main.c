/* movy-host entry: one instance, the device, the engine, then the UI until
 * SIGTERM / EXIT / host_exit_module — out within ~1 s of any of them. */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <libgen.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "audio.h"
#include "display.h"
#include "js_display.h"
#include "log.h"
#include "movy_host.h"
#include "rt.h"
#include "spi.h"
#include "testbus.h"
#include "ui.h"
#include "unified_log.h"
#include "vtable.h"

volatile int g_mh_quit;
volatile int g_mh_ui_running;
char g_mh_module_dir[256];

uint64_t mh_now_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000u + (uint64_t)ts.tv_nsec / 1000u;
}
uint64_t mh_now_ms(void) { return mh_now_us() / 1000u; }

/* When the signal landed, so every exit says how long teardown took against
 * the 1 s budget (plan WP6). clock_gettime is async-signal-safe. */
static struct timespec g_term_at;
static void on_term(int sig) {
    (void)sig;
    if (!g_mh_quit) clock_gettime(CLOCK_MONOTONIC, &g_term_at);
    g_mh_quit = 1;
}

/* dbxhost's single-instance rule: two hosts would fight for SPI (the second
 * gets EBUSY anyway) but also for the test bus port and the inject ring.
 * Read-only is enough for flock, and the file is made world-writable, so a
 * lock a root run created never locks an ableton run out (measured: it did).
 * -1 = cannot open it, -2 = another movy-host holds it. */
static int session_lock(void) {
    int fd = open("/dev/shm/.movy-session.lock", O_RDONLY | O_CREAT | O_CLOEXEC, 0666);
    if (fd < 0) return -1;
    fchmod(fd, 0666);
    if (flock(fd, LOCK_EX | LOCK_NB) != 0) { close(fd); return -2; }
    return fd;
}

/* Anything /dev/shm/movy-* is a previous movy-host's and stale by definition. */
static void sweep_stale_shm(void) {
    DIR *d = opendir("/dev/shm");
    if (!d) return;
    struct dirent *e;
    char p[300];
    while ((e = readdir(d)))
        if (!strncmp(e->d_name, "movy-", 5)) { snprintf(p, sizeof p, "/dev/shm/%s", e->d_name); unlink(p); }
    closedir(d);
}

static int version_cmp(const char *a, const char *b) {
    int x[3] = { 0 }, y[3] = { 0 };
    sscanf(a, "%d.%d.%d", &x[0], &x[1], &x[2]);
    sscanf(b, "%d.%d.%d", &y[0], &y[1], &y[2]);
    for (int i = 0; i < 3; i++) if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
}

/* The shared JS comes from the installed schwung: below the floor, refuse
 * WITH words on the screen — never a black one. */
static int schwung_too_old(mh_spi_t *spi, char *installed, size_t cap) {
    FILE *f = fopen(MH_SCHWUNG_DIR "/host/version.txt", "r");
    if (!f || !fgets(installed, (int)cap, f)) { if (f) fclose(f); snprintf(installed, cap, "?"); return 0; }
    fclose(f);
    installed[strcspn(installed, "\n")] = '\0';
    if (version_cmp(installed, SCHWUNG_FLOOR) >= 0) return 0;
    js_display_clear();
    js_display_print(0, 10, "Movy needs Schwung", 1);
    js_display_print(0, 22, SCHWUNG_FLOOR " or newer", 1);
    js_display_print(0, 34, "installed:", 1);
    js_display_print(0, 46, installed, 1);
    uint8_t packed[1024];
    js_display_pack(packed);
    for (int i = 0; i < 1700 && !g_mh_quit; i++) { spi_pump(spi); spi_serve_display(spi->map, packed); }
    return 1;
}

int main(int argc, char **argv) {
    if (argc > 1 && !strcmp(argv[1], "--version")) {
        printf("movy-host %s schwung=%s movy=%s floor=%s\n", MH_VERSION, SCHWUNG_TAG, MOVY_COMMIT, SCHWUNG_FLOOR);
        return 0;
    }
    char self[256];
    ssize_t n = readlink("/proc/self/exe", self, sizeof self - 1);
    self[n > 0 ? n : 0] = '\0';
    snprintf(g_mh_module_dir, sizeof g_mh_module_dir, "%s", argc > 2 && !strcmp(argv[1], "--module-dir") ? argv[2] : dirname(self));

    mh_log_init();
    mh_crash_install();
    mh_log("=== movy-host %s schwung=%s movy=%s pid=%d uid=%d dir=%s", MH_VERSION, SCHWUNG_TAG, MOVY_COMMIT,
           (int)getpid(), (int)getuid(), g_mh_module_dir);
    struct sigaction sa = { .sa_handler = on_term };
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);

    int lock = session_lock();
    if (lock == -2) { mh_log("another movy-host holds the session lock; exiting"); return 1; }
    if (lock < 0) { mh_log("cannot open the session lock (%s); exiting", strerror(errno)); return 1; }
    sweep_stale_shm();
    rt_init();

    /* launch-standalone.sh kills the SPI holder and then starts us at once; a
     * Move that was itself mid-boot can still be letting go. Bounded. */
    mh_spi_t spi;
    int e = spi_open(&spi);
    for (int i = 0; i < 30 && e == -EBUSY && !g_mh_quit; i++) {
        struct timespec ts = { 0, 100000000L };
        nanosleep(&ts, NULL);
        e = spi_open(&spi);
    }
    if (e) { mh_log("spi: open %s failed (%s) — is Move still running?", "/dev/ablspi0.0", strerror(-e)); return 1; }
    char installed[32];
    if (schwung_too_old(&spi, installed, sizeof installed)) {
        mh_log("schwung %s is below the floor %s; refusing", installed, SCHWUNG_FLOOR);
        spi_close(&spi);
        return 2;
    }
    display_init();
    audio_start(&spi);
    char path[320];
    snprintf(path, sizeof path, "%s/dsp.so", g_mh_module_dir);
    engine_load(path, g_mh_module_dir);
    testbus_start();

    snprintf(path, sizeof path, "%s/ui.js", g_mh_module_dir);
    int rc = ui_run(path);

    g_mh_quit = 1;
    audio_stop();
    engine_unload();
    spi_close(&spi);
    if (g_term_at.tv_sec) {
        uint64_t at = (uint64_t)g_term_at.tv_sec * 1000000u + (uint64_t)g_term_at.tv_nsec / 1000u;
        mh_log("=== movy-host exit %d, %llu ms after the signal", rc, (unsigned long long)((mh_now_us() - at) / 1000));
    } else {
        mh_log("=== movy-host exit %d", rc);
    }
    return rc;   /* mh_log_init's atexit drains the log */
}
