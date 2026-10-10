#ifndef MH_LOG_H
#define MH_LOG_H

/* unified_log + the ring's writer thread, flushed at exit. Before any line. */
void mh_log_init(void);

/* Every movy-host line goes through the ring (log_ring.h) to unified_log (debug.log, gated by
 * debug_log_on, the format the dev tools already read) AND stderr, which the
 * launcher sends to movy-host.log so a launch is debuggable with the flag off. */
void mh_log(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
void mh_log_src(const char *src, const char *fmt, ...) __attribute__((format(printf, 2, 3)));

/* SIGSEGV/SIGBUS/SIGILL/SIGFPE/SIGABRT → a backtrace into debug.log, whatever
 * the flag says: a crash with no trace is the failure this exists to end. */
void mh_crash_install(void);

#endif
