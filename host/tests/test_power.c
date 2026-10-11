/* power.c: the hold after a shutdown request, and the test bus's dry run. */
#define _GNU_SOURCE
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "power.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

void mh_log(const char *fmt, ...) { (void)fmt; }
int testbus_flag_present(void) { return 1; }

static void sleep_ms(int ms) { struct timespec t = { ms / 1000, (ms % 1000) * 1000000L }; nanosleep(&t, NULL); }
static double now_s(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

static void test_hold_outlives_sigterm(void) {
    double t0 = now_s();
    pid_t pid = fork();
    if (pid == 0) { power_hold(1); _exit(7); }
    sleep_ms(100);
    kill(pid, SIGTERM);
    kill(pid, SIGHUP);
    sleep_ms(200);
    int status = 0;
    CHECK(waitpid(pid, &status, WNOHANG) == 0, "the shutdown's SIGTERM must not end the hold (the launcher would restart Move)");
    waitpid(pid, &status, 0);
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 7, "a shutdown that never comes ends the hold, so Move comes back");
    CHECK(now_s() - t0 >= 0.95, "the hold lasts its bound (%.2f s)", now_s() - t0);
}

static void test_dry_run_does_not_hold(void) {
    CHECK(power_off_now() == 0, "a test-bus dry run reports no shutdown, so main never holds");
}

int main(void) {
    test_hold_outlives_sigterm();
    test_dry_run_does_not_hold();
    printf("movy-host power tests: %d checks, %d failed\n", checks, fails);
    return fails != 0;
}
