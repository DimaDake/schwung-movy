#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <unistd.h>

#include "fork_watch.h"
#include "log.h"

int fork_watch_format(char *out, size_t cap, const char *thread, int pid) {
    return snprintf(out, cap, "audio: fork by %s (pid %d)", thread && *thread ? thread : "?", pid);
}

/* The prepare handler, so the line names the thread that asked, before the
 * fork itself; it runs on that thread, never the audio thread unless the
 * audio thread is the one forking. */
static void on_fork(void) {
    char name[16] = "", line[96];
    pthread_getname_np(pthread_self(), name, sizeof name);
    fork_watch_format(line, sizeof line, name, (int)getpid());
    mh_log("%s", line);
}

void fork_watch_install(void) {
    pthread_atfork(on_fork, NULL, NULL);
}
