#define _GNU_SOURCE
#include <stdio.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "log.h"
#include "movy_host.h"
#include "power.h"

#define DBUS_SEND "/usr/bin/dbus-send"

volatile int g_mh_poweroff;

void power_off_now(void) {
    char flag[300];
    struct stat st;
    snprintf(flag, sizeof flag, "%s/testbus", g_mh_module_dir);
    if (stat(flag, &st) == 0) {
        mh_log("power: DRY RUN (test bus) — would call com.ableton.system Power.shutDown");
        return;
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
    if (pid < 0 || waitpid(pid, &status, 0) < 0) { mh_log("power: could not run %s", DBUS_SEND); return; }
    mh_log("power: dbus-send exited %d", WIFEXITED(status) ? WEXITSTATUS(status) : -1);
}
