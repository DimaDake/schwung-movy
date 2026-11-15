#define _GNU_SOURCE
#include "link_host.h"

#include <fcntl.h>
#include <stdio.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "log.h"
#include "movy_link_shm.h"

void link_host_init(const char *shm_dir) {
    char path[256];
    snprintf(path, sizeof path, "%s%s", shm_dir, MOVY_LINK_SHM);
    /* Fresh every start: the sweep removed the last movy-host's, and a helper
     * still holding that one sees its heartbeat stop and moves on. */
    unlink(path);
    int fd = open(path, O_RDWR | O_CREAT | O_EXCL, 0666);
    if (fd < 0) { mh_log("link: cannot create %s; Link stays off", path); return; }
    fchmod(fd, 0666);   /* movy-link may run as another uid than we do */
    void *p = MAP_FAILED;
    if (ftruncate(fd, (off_t)sizeof(movy_link_shm_t)) == 0)
        p = mmap(NULL, sizeof(movy_link_shm_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) { mh_log("link: cannot map %s; Link stays off", path); return; }
    movy_link_shm_t *s = p;
    s->host_pid = (uint32_t)getpid();
    s->version = MOVY_LINK_VERSION;
    /* Last: a reader that sees the magic sees everything before it. */
    __atomic_store_n(&s->magic, MOVY_LINK_MAGIC, __ATOMIC_RELEASE);
    /* Never unmapped: the segment lives as long as this movy-host. */
}
