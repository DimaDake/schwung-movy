/* link_host.c: movy-host's two jobs for movy-link — create the segment, and
 * publish the "Movy Link" setting into it. */
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

static char dir[64], feat[128];

static void write_features(const char *text) {
    FILE *f = fopen(feat, "w");
    fputs(text, f);
    fclose(f);
    /* features_read_if_changed keys on mtime; force a visible change. */
    struct timespec ts[2] = { { 0, UTIME_NOW }, { 0, UTIME_NOW } };
    static long bump = 1;
    ts[1].tv_sec = 1000000 + bump++; ts[1].tv_nsec = 0;
    utimensat(AT_FDCWD, feat, ts, 0);
}

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
    snprintf(feat, sizeof feat, "%s/features.json", dir);

    /* flag_true_false_absent */
    CHECK(link_flag_parse("{\"movy_link_enabled\": true}") == 1, "true");
    CHECK(link_flag_parse("{\"movy_link_enabled\": false}") == 0, "false");
    CHECK(link_flag_parse("{}") == 0, "absent");
    CHECK(link_flag_parse("") == 0, "empty");

    /* creates_segment_with_magic: off until the setting says otherwise */
    write_features("{}");
    link_host_init(dir, feat);
    movy_link_shm_t *s = map_segment();
    CHECK(s != NULL, "segment exists");
    if (s) {
        CHECK(s->magic == MOVY_LINK_MAGIC && s->version == MOVY_LINK_VERSION, "magic/version");
        CHECK(s->host_pid == (uint32_t)getpid(), "pid");
        CHECK(s->enabled == 0, "off by default");

        /* poll_updates_enabled: only on a poll tick */
        write_features("{\"movy_link_enabled\": true}");
        link_host_poll(1);
        CHECK(s->enabled == 0, "between poll ticks nothing changes");
        link_host_poll(0);
        CHECK(s->enabled == 1, "on after poll");
        write_features("{\"movy_link_enabled\": false}");
        link_host_poll(0);
        CHECK(s->enabled == 0, "off again");
    }

    char p[128];
    snprintf(p, sizeof p, "%s%s", dir, MOVY_LINK_SHM); unlink(p); unlink(feat); rmdir(dir);
    printf("link_host: %d/%d checks passed\n", checks - fails, checks);
    return fails != 0;
}
