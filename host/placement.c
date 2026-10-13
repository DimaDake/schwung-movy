#define _GNU_SOURCE
#include <dirent.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "audio.h"
#include "log.h"
#include "movy_host.h"
#include "placement.h"

#define SWEEP_MS 1000
#define MAX_KIDS 32

static uint64_t g_next_ms;

static void sweep_tasks(int pid) {
    char dir[64];
    snprintf(dir, sizeof dir, "/proc/%d/task", pid);
    DIR *d = opendir(dir);
    if (!d) return;
    struct dirent *e;
    while ((e = readdir(d))) {
        int tid = atoi(e->d_name);
        if (tid <= 0) continue;
        cpu_set_t set;
        CPU_ZERO(&set);
        if (sched_getaffinity(tid, sizeof set, &set) != 0) continue;
        uint64_t mask = 0;
        for (int c = 0; c < 64; c++) if (CPU_ISSET(c, &set)) mask |= 1ull << c;
        if (!placement_should_move(mask, tid == audio_tid())) continue;
        CPU_ZERO(&set);
        for (int c = 0; c < 3; c++) CPU_SET(c, &set);
        int rc = sched_setaffinity(tid, sizeof set, &set);
        char path[96], comm[32] = "?";
        snprintf(path, sizeof path, "%s/%d/comm", dir, tid);
        FILE *f = fopen(path, "r");
        if (f) { if (fgets(comm, sizeof comm, f)) comm[strcspn(comm, "\n")] = '\0'; fclose(f); }
        mh_log("placement: pid %d tid %d (%s) was pinned to the audio core; moved to 0-2 %s",
               pid, tid, comm, rc == 0 ? "ok" : "REFUSED");
    }
    closedir(d);
}

/* The parent pid from /proc/<pid>/stat: field 4, counted after the comm's
 * closing paren, since a comm may hold spaces and parens. */
static int ppid_of(const char *pid) {
    char path[64], buf[256];
    snprintf(path, sizeof path, "/proc/%s/stat", pid);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    fclose(f);
    buf[n] = '\0';
    char *p = strrchr(buf, ')');
    int ppid = -1;
    return p && sscanf(p + 1, " %*c %d", &ppid) == 1 ? ppid : -1;
}

void placement_poll(void) {
    uint64_t now = mh_now_ms();
    if (now < g_next_ms) return;
    g_next_ms = now + SWEEP_MS;
    int self = (int)getpid(), fam[MAX_KIDS + 1] = { self }, nfam = 1;
    sweep_tasks(self);
    DIR *d = opendir("/proc");
    if (!d) return;
    struct dirent *e;
    while ((e = readdir(d)) && nfam <= MAX_KIDS) {
        if (e->d_name[0] < '1' || e->d_name[0] > '9') continue;
        int ppid = ppid_of(e->d_name);
        /* Children and their children: a forked helper may fork again. A
         * grandchild listed before its parent (pid wrap) waits a sweep. */
        for (int i = 0; i < nfam; i++) {
            if (ppid != fam[i]) continue;
            fam[nfam++] = atoi(e->d_name);
            sweep_tasks(fam[nfam - 1]);
            break;
        }
    }
    closedir(d);
}
