/* link_host.c: movy-host creates the segment movy-link and the engine share. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "link_host.h"
#include "movy_link_shm.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

void mh_log(const char *fmt, ...) { (void)fmt; }

static char dir[64];

static movy_link_shm_t *map_segment(void) {
    char p[128];
    snprintf(p, sizeof p, "%s%s", dir, MOVY_LINK_SHM);
    int fd = open(p, O_RDONLY);
    if (fd < 0) return NULL;
    void *m = mmap(NULL, sizeof(movy_link_shm_t), PROT_READ, MAP_SHARED, fd, 0);
    close(fd);
    return m == MAP_FAILED ? NULL : m;
}

int main(void) {
    snprintf(dir, sizeof dir, "/tmp/movy-link-test-%d", getpid());
    mkdir(dir, 0755);

    /* creates_segment_with_magic, and leaves Link OFF: the switch is movy's
     * own Settings row, which reaches the segment through the engine. */
    link_host_init(dir);
    movy_link_shm_t *s = map_segment();
    CHECK(s != NULL, "segment exists");
    if (s) {
        CHECK(s->magic == MOVY_LINK_MAGIC && s->version == MOVY_LINK_VERSION, "magic/version");
        CHECK(s->host_pid == (uint32_t)getpid(), "pid");
        CHECK(s->enabled == 0, "off until the engine says otherwise");
    }
    /* A second start replaces the segment rather than failing on O_EXCL. */
    link_host_init(dir);
    CHECK(map_segment() != NULL, "recreated");

    char p[128];
    snprintf(p, sizeof p, "%s%s", dir, MOVY_LINK_SHM); unlink(p); rmdir(dir);
    printf("link_host: %d/%d checks passed\n", checks - fails, checks);
    return fails != 0;
}
