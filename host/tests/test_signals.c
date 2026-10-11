/* signals.c: a TERM blocked by the parent (MoveLauncher, at the boot door)
 * still reaches movy-host. */
#define _GNU_SOURCE
#include <signal.h>
#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>

#include "signals.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

static volatile sig_atomic_t got;
static void on_term(int sig) { got = sig; }

/* The child inherits the boot door's mask, then exec-free does what main does. */
static int child_sees(int sig) {
    pid_t pid = fork();
    if (pid == 0) {
        sigset_t s;
        sigemptyset(&s);
        sigaddset(&s, SIGTERM); sigaddset(&s, SIGINT); sigaddset(&s, SIGUSR1);
        sigprocmask(SIG_BLOCK, &s, NULL);
        mh_signals_install(on_term);
        raise(sig);
        _exit(got == sig ? 0 : 1);
    }
    int status = 0;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

int main(void) {
    CHECK(child_sees(SIGTERM), "a TERM blocked by the parent must still reach the handler (boot-door stop)");
    CHECK(child_sees(SIGINT), "and so must INT");
    printf("movy-host signal tests: %d checks, %d failed\n", checks, fails);
    return fails != 0;
}
