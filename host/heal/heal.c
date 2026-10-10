/* bin/heal — movy-host's root helper (WP0 findings §3, finding 1).
 *
 * ableton cannot get SCHED_FIFO (MoveOriginal gets it from file caps, which a
 * store reinstall would drop from ours), and RT is required: without it one
 * frame in a thousand runs >1 ms late. So movy-host runs as ableton and asks
 * this one closed question, `heal rt <pid> [<audio tid>]`: schwung-heal installs it from
 * bin/heal.new as root 04755 (docs/MODULES.md, "Some standalone tools need one
 * privileged step").
 *
 * It touches ONLY a process whose executable is the movy-host beside it, and
 * ONLY that process's audio thread (FIFO 70, Move's audio priority) and
 * movy-render* threads (FIFO 68, below it), plus its RLIMIT_MEMLOCK. The audio
 * thread goes by tid, not name: a thread spawned FROM it inherits "movy-audio"
 * and must not be promoted with it. Nothing
 * from the environment is read, nothing is executed, and it exits at once. */
#define _GNU_SOURCE
#include <dirent.h>
#include <limits.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <unistd.h>

static int exe_of(const char *proc, char *out, size_t cap) {
    ssize_t n = readlink(proc, out, cap - 1);
    if (n <= 0) return -1;
    out[n] = '\0';
    return 0;
}

static int read_comm(pid_t pid, const char *tid, char *out, size_t cap) {
    char path[320];
    snprintf(path, sizeof path, "/proc/%d/task/%s/comm", (int)pid, tid);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    if (!fgets(out, (int)cap, f)) { fclose(f); return -1; }
    fclose(f);
    out[strcspn(out, "\n")] = '\0';
    return 0;
}

int main(int argc, char **argv) {
    if ((argc != 3 && argc != 4) || strcmp(argv[1], "rt") != 0) {
        fprintf(stderr, "usage: heal rt <pid> [<audio tid>]\n");
        return 2;
    }
    char *endp;
    long pid = strtol(argv[2], &endp, 10);
    if (*endp || pid <= 1) return 2;
    long audio_tid = 0;
    if (argc == 4 && ((audio_tid = strtol(argv[3], &endp, 10)) <= 1 || *endp)) return 2;

    char self[PATH_MAX], want[PATH_MAX + 16], target[PATH_MAX], proc[64];
    if (exe_of("/proc/self/exe", self, sizeof self) < 0) return 3;
    char *slash = strrchr(self, '/');                  /* <dir>/bin/heal */
    if (!slash) return 3;
    *slash = '\0';
    slash = strrchr(self, '/');                        /* <dir>/bin */
    if (!slash || strcmp(slash, "/bin") != 0) return 3;
    *slash = '\0';
    snprintf(want, sizeof want, "%s/movy-host", self);
    snprintf(proc, sizeof proc, "/proc/%ld/exe", pid);
    if (exe_of(proc, target, sizeof target) < 0 || strcmp(target, want) != 0) {
        fprintf(stderr, "heal: pid %ld is not %s\n", pid, want);
        return 4;
    }

    struct rlimit inf = { RLIM_INFINITY, RLIM_INFINITY };
    int bad = prlimit((pid_t)pid, RLIMIT_MEMLOCK, &inf, NULL) != 0;
    char task_dir[64];
    snprintf(task_dir, sizeof task_dir, "/proc/%ld/task", pid);
    DIR *d = opendir(task_dir);
    if (!d) return 5;
    struct dirent *e;
    int promoted = 0;
    while ((e = readdir(d))) {
        char comm[32];
        if (e->d_name[0] == '.' || read_comm((pid_t)pid, e->d_name, comm, sizeof comm) < 0) continue;
        long tid = atol(e->d_name);
        int prio = tid == audio_tid ? 70 : strncmp(comm, "movy-render", 11) == 0 ? 68 : 0;
        if (!prio) continue;
        struct sched_param sp = { .sched_priority = prio };
        if (sched_setscheduler((pid_t)tid, SCHED_FIFO, &sp) == 0) promoted++;
        else bad = 1;
    }
    closedir(d);
    printf("heal: pid %ld promoted %d thread(s)%s\n", pid, promoted, bad ? " (some refused)" : "");
    return bad ? 6 : 0;
}
