#define _GNU_SOURCE
#include <dirent.h>
#include <sched.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "audio.h"
#include "log.h"
#include "movy_host.h"
#include "rt.h"

#define MAX_HELPER_RUNS 8

extern char **environ;
static char g_helper[300];
static int g_runs, g_locked, g_warned;
static uint64_t g_next_ms;

static int helper_usable(void);
static int run_helper(void);

/* Before the audio thread exists: locking memory faults in every page under
 * the process's mm lock, which stalled a live audio thread 85 ms (measured).
 * As ableton the limit is too low, so the helper raises it first. */
void rt_init(void) {
    snprintf(g_helper, sizeof g_helper, "%s/bin/heal", g_mh_module_dir);
    g_locked = mlockall(MCL_CURRENT | MCL_FUTURE) == 0;
    if (!g_locked && helper_usable() && run_helper() == 0) g_locked = mlockall(MCL_CURRENT | MCL_FUTURE) == 0;
    mh_log("rt: memory %s", g_locked ? "locked" : "NOT locked (degraded)");
}

const char *rt_state(void) {
    int tid = audio_tid();
    return tid > 0 && sched_getscheduler(tid) == SCHED_FIFO ? "fifo70" : "other";
}

/* Threads that should be FIFO and are not. */
static int unpromoted(void) {
    DIR *d = opendir("/proc/self/task");
    if (!d) return 0;
    struct dirent *e;
    int n = 0;
    while ((e = readdir(d))) {
        char path[320], comm[32] = "";
        snprintf(path, sizeof path, "/proc/self/task/%s/comm", e->d_name);
        FILE *f = e->d_name[0] == '.' ? NULL : fopen(path, "r");
        if (!f) continue;
        if (fgets(comm, sizeof comm, f)) comm[strcspn(comm, "\n")] = '\0';
        fclose(f);
        if (atoi(e->d_name) != audio_tid() && strncmp(comm, "movy-render", 11)) continue;
        if (sched_getscheduler(atoi(e->d_name)) != SCHED_FIFO) n++;
    }
    closedir(d);
    return n;
}

static int helper_usable(void) {
    struct stat st;
    return stat(g_helper, &st) == 0 && st.st_uid == 0 && (st.st_mode & S_ISUID);
}

void rt_poll(void) {
    uint64_t now = mh_now_ms();
    if (now < g_next_ms || g_runs >= MAX_HELPER_RUNS) return;
    g_next_ms = now + 1000;
    int n = unpromoted();
    if (n == 0) return;
    if (!helper_usable()) {
        if (!g_warned++) mh_log("rt: %d thread(s) not SCHED_FIFO and %s is not root 04755 — running DEGRADED", n, g_helper);
        return;
    }
    int rc = run_helper();
    g_runs++;
    mh_log("rt: helper run %d for %d thread(s): exit %d", g_runs, n, rc);
}

static int run_helper(void) {
    char pid[16], tid[16];
    snprintf(pid, sizeof pid, "%d", (int)getpid());
    snprintf(tid, sizeof tid, "%d", audio_tid());
    char *argv[] = { g_helper, "rt", pid, audio_tid() > 0 ? tid : NULL, NULL };
    pid_t child;
    int status = -1;
    if (posix_spawn(&child, g_helper, NULL, NULL, argv, environ) == 0) waitpid(child, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}
