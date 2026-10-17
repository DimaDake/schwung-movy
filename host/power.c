#define _GNU_SOURCE
#include <signal.h>
#include <stdio.h>
#include <time.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "log.h"
#include "movy_host.h"
#include "power.h"
#include "testbus.h"

#define DBUS_SEND "/usr/bin/dbus-send"

volatile int g_mh_poweroff;

int power_off_now(void) {
    if (testbus_flag_present()) {
        mh_log("power: DRY RUN (test bus) — would call com.ableton.system Power.shutDown");
        return 0;
    }
    mh_log("power: Power.shutDown via com.ableton.system");
    pid_t pid = fork();
    if (pid == 0) {
        /* --print-reply makes it a method call that waits for the answer. */
        execl(DBUS_SEND, DBUS_SEND, "--system", "--print-reply", "--dest=com.ableton.system",
              "/com/ableton/System/Power", "com.ableton.system.shutDown", (char *)NULL);
        _exit(127);
    }
    int status = 0;
    if (pid < 0 || waitpid(pid, &status, 0) < 0) { mh_log("power: could not run %s", DBUS_SEND); return 0; }
    int rc = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    mh_log("power: dbus-send exited %d", rc);
    return rc == 0;
}

void power_hold(int seconds, void (*tick)(void *), void *arg) {
    /* The shutdown SIGTERMs everyone; launch-standalone.sh's shell dies of
     * it, and we must outlive the shell or it restarts Move. */
    signal(SIGTERM, SIG_IGN);
    signal(SIGINT, SIG_IGN);
    signal(SIGHUP, SIG_IGN);
    mh_log("power: holding up to %d s for the power to go", seconds);
    if (tick) {
        struct timespec t0, now;
        clock_gettime(CLOCK_MONOTONIC, &t0);
        do {
            tick(arg);
            clock_gettime(CLOCK_MONOTONIC, &now);
        } while ((now.tv_sec - t0.tv_sec) * 1000000000LL + (now.tv_nsec - t0.tv_nsec) < seconds * 1000000000LL);
    } else {
        struct timespec left = { seconds, 0 };
        while (nanosleep(&left, &left) < 0) {}
    }
    mh_log("power: still running after %d s — shutdown failed, giving Move back", seconds);
}
