/* mkdir_p.c: host_ensure_dir without a child process; fork_watch.c's line. */
#include <errno.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "fork_watch.h"
#include "glitch_log.h"
#include "mkdir_p.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

/* fork_watch.c logs through mh_log; the test only needs the format. */
void mh_log(const char *fmt, ...) { (void)fmt; }

static int forks;
static void count_fork(void) { forks++; }

static int is_dir(const char *p) { struct stat st; return stat(p, &st) == 0 && S_ISDIR(st.st_mode); }

int main(void) {
    char root[] = "/tmp/mkdirp-XXXXXX", p[512];
    if (!mkdtemp(root)) { perror("mkdtemp"); return 1; }
    pthread_atfork(count_fork, NULL, NULL);

    snprintf(p, sizeof p, "%s/sets/abc/v/3", root);
    CHECK(mh_mkdir_p(p) == 0 && is_dir(p), "creates every missing parent: %s", p);
    CHECK(mh_mkdir_p(p) == 0, "an existing directory is success");
    snprintf(p, sizeof p, "%s/sets/abc//v/3/", root);
    CHECK(mh_mkdir_p(p) == 0, "doubled and trailing slashes are harmless");
    CHECK(forks == 0, "the whole point: no child process (%d forks)", forks);

    snprintf(p, sizeof p, "%s/file", root);
    FILE *f = fopen(p, "w"); if (f) fclose(f);
    CHECK(mh_mkdir_p(p) == -1 && errno == ENOTDIR, "a file in the way is a failure, not success");
    snprintf(p, sizeof p, "%s/file/sub", root);
    CHECK(mh_mkdir_p(p) == -1, "a file as a parent fails");
    CHECK(mh_mkdir_p("") == -1 && mh_mkdir_p(NULL) == -1, "no path, no directory");

    /* Teeth for the counter itself: a real fork is seen. */
    pid_t pid = fork();
    if (pid == 0) _exit(0);
    waitpid(pid, NULL, 0);
    CHECK(forks == 1, "the atfork counter sees a fork (%d)", forks);

    char line[96];
    fork_watch_format(line, sizeof line, "movy-host", 911);
    CHECK(!strcmp(line, "audio: fork by movy-host (pid 911)"), "%s", line);
    CHECK(glitch_log_keeps(line), "the fork line reaches movy-glitch.log");
    fork_watch_format(line, sizeof line, "", 1);
    CHECK(strstr(line, "by ?") != NULL, "an unnamed thread still logs: %s", line);

    snprintf(p, sizeof p, "rm -rf %s", root);
    if (system(p) != 0) printf("  (could not clean %s)\n", root);
    printf("test_mkdir_p: %d/%d passed\n", checks - fails, checks);
    return fails ? 1 : 0;
}
