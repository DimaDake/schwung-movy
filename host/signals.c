#define _GNU_SOURCE
#include <signal.h>
#include <stddef.h>

#include "signals.h"

void mh_signals_install(void (*on_term)(int)) {
    struct sigaction sa = { .sa_handler = on_term };
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);
    sigset_t s;
    sigemptyset(&s);
    sigaddset(&s, SIGTERM);
    sigaddset(&s, SIGINT);
    sigprocmask(SIG_UNBLOCK, &s, NULL);
}
