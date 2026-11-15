#define _GNU_SOURCE
#include "link_host.h"

#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "log.h"
#include "movy_link_shm.h"
#include "settings_file.h"

/* The setting is a stat() every POLL_TICKS UI ticks (~0.5 s), as mirror.c. */
#define POLL_TICKS 64

static movy_link_shm_t *g_shm;
static features_file_t g_features;

int link_flag_parse(const char *json) {
    const char *v = features_value(json, "movy_link_enabled");
    return v && strncmp(v, "true", 4) == 0;
}

static void read_setting(void) {
    static char buf[16384];
    if (!g_shm || !features_read_if_changed(&g_features, buf, sizeof buf)) return;
    uint32_t on = (uint32_t)link_flag_parse(buf);   /* absent: off */
    if (on != __atomic_load_n(&g_shm->enabled, __ATOMIC_RELAXED))
        mh_log("link: %s (Movy Link %s)", on ? "enabled" : "disabled", on ? "on" : "off");
    __atomic_store_n(&g_shm->enabled, on, __ATOMIC_RELEASE);
}

void link_host_init(const char *shm_dir, const char *features_path) {
    features_open(&g_features, features_path);
    char path[256];
    snprintf(path, sizeof path, "%s%s", shm_dir, MOVY_LINK_SHM);
    /* Fresh every start: the sweep removed the last movy-host's, and a helper
     * still holding that one sees its heartbeat stop and exits. */
    unlink(path);
    int fd = open(path, O_RDWR | O_CREAT | O_EXCL, 0666);
    if (fd < 0) { mh_log("link: cannot create %s; Link stays off", path); return; }
    fchmod(fd, 0666);   /* movy-link may run as another uid than we do */
    void *p = MAP_FAILED;
    if (ftruncate(fd, (off_t)sizeof(movy_link_shm_t)) == 0)
        p = mmap(NULL, sizeof(movy_link_shm_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) { mh_log("link: cannot map %s; Link stays off", path); return; }
    g_shm = p;
    g_shm->host_pid = (uint32_t)getpid();
    g_shm->version = MOVY_LINK_VERSION;
    /* Last: a reader that sees the magic sees everything before it. */
    __atomic_store_n(&g_shm->magic, MOVY_LINK_MAGIC, __ATOMIC_RELEASE);
    read_setting();
}

void link_host_poll(int tick) {
    if (tick % POLL_TICKS == 0) read_setting();
}
