#define _GNU_SOURCE
#include <execinfo.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "log.h"
#include "log_ring.h"
#include "movy_host.h"
#include "unified_log.h"

/* The ring's one writer is the only caller of unified_log (log_ring.h says
 * why). debug.log stamps the line when it is written, up to a few ms after it
 * was said; stderr (movy-host.log) carries the time it was pushed. */
static void sink(const log_line_t *l) {
    unified_log(l->src, LOG_LEVEL_INFO, "%s", l->text);
    fprintf(stderr, "%lld.%03lld [%s] %s\n", (long long)(l->ms / 1000), (long long)(l->ms % 1000), l->src, l->text);
}

static void mh_log_shutdown(void) {
    log_ring_stop();
    unified_log_shutdown();
}

void mh_log_init(void) {
    unified_log_init();
    log_ring_start(sink);
    atexit(mh_log_shutdown);
}

static void vlog(const char *src, const char *fmt, va_list ap) {
    char line[LOG_RING_TEXT];
    vsnprintf(line, sizeof line, fmt, ap);
    log_ring_push(src, line);
}

void mh_log(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vlog("movy-host", fmt, ap);
    va_end(ap);
}

void mh_log_src(const char *src, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vlog(src, fmt, ap);
    va_end(ap);
}

static int g_crash_fd = -1;

static void crash_write(const char *s) {
    if (g_crash_fd >= 0 && write(g_crash_fd, s, strlen(s)) < 0) { /* nowhere left to say it */ }
    if (write(STDERR_FILENO, s, strlen(s)) < 0) { }
}

/* Async-signal-safe apart from backtrace(), whose first call may allocate —
 * which is why mh_crash_install primes it. */
static void on_crash(int sig) {
    char head[96];
    const char *name = sig == SIGSEGV ? "SIGSEGV" : sig == SIGBUS ? "SIGBUS"
                     : sig == SIGILL ? "SIGILL" : sig == SIGFPE ? "SIGFPE" : "SIGABRT";
    int n = snprintf(head, sizeof head, "\n[movy-host] CRASH %s pid %d, backtrace:\n", name, (int)getpid());
    /* What was said last is the context a backtrace needs, and the writer
     * thread may not have reached it. */
    if (g_crash_fd >= 0) log_ring_flush_raw(g_crash_fd);
    log_ring_flush_raw(STDERR_FILENO);
    if (n > 0) crash_write(head);
    void *frames[48];
    int depth = backtrace(frames, 48);
    if (g_crash_fd >= 0) backtrace_symbols_fd(frames, depth, g_crash_fd);
    backtrace_symbols_fd(frames, depth, STDERR_FILENO);
    signal(sig, SIG_DFL);
    raise(sig);
}

void mh_crash_install(void) {
    g_crash_fd = open(UNIFIED_LOG_PATH, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0644);
    void *prime[1];
    backtrace(prime, 1);
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_crash;
    sa.sa_flags = SA_RESETHAND;
    int sigs[] = { SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGABRT };
    for (unsigned i = 0; i < sizeof sigs / sizeof sigs[0]; i++) sigaction(sigs[i], &sa, NULL);
}
