/* Names every fork() movy-host makes in the glitch log.
 *
 * A fork stalls the audio thread for its whole duration (mkdir_p.h says why),
 * and the over-budget frame it causes blames whichever stage happened to be
 * running: io, render, post or an engine step. Without this line the report
 * ranks a stage that did nothing wrong. A module that spawns a helper or a
 * schwung global built on run_command shows up here too. */
#ifndef MH_FORK_WATCH_H
#define MH_FORK_WATCH_H

#include <stddef.h>

/* "audio: fork by <thread> (pid <n>)" into `out`; returns its length. */
int fork_watch_format(char *out, size_t cap, const char *thread, int pid);

/* Installs the pthread_atfork hook that logs that line. Once, at startup. */
void fork_watch_install(void);

#endif
