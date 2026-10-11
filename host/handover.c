#define _GNU_SOURCE
#include <stddef.h>
#include <unistd.h>

#include "handover.h"
#include "log.h"
#include "signals.h"

static volatile int g_armed;

const char *const MH_HANDOVER_CHAIN[] = {
    "/data/UserData/schwung/schwung-entry.sh", "/opt/move/Move", "/opt/move/MoveOriginal", NULL,
};

void handover_arm(void) { g_armed = 1; }
int handover_armed(void) { return g_armed; }

void handover_exec(const char *const *chain) {
    for (int fd = 3; fd < 1024; fd++) close(fd);
    for (; *chain; chain++) {
        char *const argv[] = { (char *)*chain, NULL };
        execv(*chain, argv);
    }
}

int handover_or_exit_via(int rc, const char *const *chain) {
    if (!g_armed || rc == MH_RC_TERM) return rc;
    mh_log("boot exit (rc %d): handing the device to Schwung", rc);
    mh_log_close();
    handover_exec(chain);
    return rc;   /* nothing to exec: the device is past saving here */
}

int handover_or_exit(int rc) { return handover_or_exit_via(rc, MH_HANDOVER_CHAIN); }
