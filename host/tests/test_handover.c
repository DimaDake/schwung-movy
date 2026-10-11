/* handover.c: the boot door's exec chain — fallbacks, fds, and the stop. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "handover.h"
#include "signals.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

void mh_log(const char *fmt, ...) { (void)fmt; }
void mh_log_close(void) {}

static char dir[] = "/tmp/movy-handover-XXXXXX";   /* host-side test only */
static char script[300], marker[300];

/* A stand-in for schwung-entry.sh: records whether fd 9 reached it. */
static void write_script(void) {
    snprintf(script, sizeof script, "%s/entry.sh", dir);
    snprintf(marker, sizeof marker, "%s/ran", dir);
    FILE *f = fopen(script, "w");
    fprintf(f, "#!/bin/sh\nif [ -e /dev/fd/9 ]; then echo leaked > %s; else echo clean > %s; fi\n", marker, marker);
    fclose(f);
    chmod(script, 0755);
}

static const char *read_marker(void) {
    static char buf[32];
    buf[0] = '\0';
    FILE *f = fopen(marker, "r");
    if (f) { if (!fgets(buf, sizeof buf, f)) buf[0] = '\0'; fclose(f); }
    buf[strcspn(buf, "\n")] = '\0';
    return buf;
}

/* rc the child exits with when nothing was exec'd. */
static int run_child(int armed, int rc, const char *const *chain, const char *const *via) {
    unlink(marker);
    pid_t pid = fork();
    if (pid == 0) {
        int fd = open(script, O_RDONLY);   /* stands in for the SPI fd */
        if (fd >= 0 && fd != 9) { dup2(fd, 9); close(fd); }
        if (armed) handover_arm();
        if (chain) { handover_exec(chain); _exit(99); }
        _exit(via ? handover_or_exit_via(rc, via) : handover_or_exit(rc));
    }
    int status = 0;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

int main(void) {
    if (!mkdtemp(dir)) { perror("mkdtemp"); return 1; }
    write_script();
    const char *chain[] = { "/nonexistent/schwung-entry.sh", script, NULL };
    run_child(1, 0, chain, NULL);
    CHECK(!strcmp(read_marker(), "clean"), "a missing first entry falls through to the next (got '%s')", read_marker());
    CHECK(strcmp(read_marker(), "leaked"), "the device fd must not reach Schwung (SPI is exclusive)");
    const char *none[] = { "/nonexistent/a", "/nonexistent/b", NULL };
    CHECK(run_child(1, 0, none, NULL) == 99, "nothing to exec returns, so the caller can still exit");
    CHECK(run_child(0, 3, NULL, chain) == 3 && !*read_marker(),
          "the Tools door never hands over: launch-standalone.sh brings Move back");
    CHECK(run_child(1, MH_RC_TERM, NULL, chain) == MH_RC_TERM && !*read_marker(),
          "a stop never starts Schwung, even at the boot door");
    run_child(1, 3, NULL, chain);
    CHECK(!strcmp(read_marker(), "clean"), "a UI error at the boot door still hands over (got '%s')", read_marker());
    CHECK(!strcmp(MH_HANDOVER_CHAIN[0], "/data/UserData/schwung/schwung-entry.sh"),
          "Schwung first, not the picker (which could drop the user back into movy)");
    unlink(script); unlink(marker); rmdir(dir);
    printf("movy-host handover tests: %d checks, %d failed\n", checks, fails);
    return fails != 0;
}
