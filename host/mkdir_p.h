/* `mkdir -p` without a child process, behind movy's host_ensure_dir.
 *
 * schwung's host_ensure_dir runs `mkdir -p` through run_command, a fork().
 * Forking a process this size write-locks its whole address space and
 * write-protects every page for copy-on-write, so the audio thread's next
 * memory access sleeps until the fork returns: 4-20 ms on the device,
 * growing with the set's RSS. movy's autosave ensures the Set directory on
 * every write, so a volume knob being turned clicked every save. */
#ifndef MH_MKDIR_P_H
#define MH_MKDIR_P_H

/* Creates `path` and any missing parents (mode 0755). 0 when the directory
 * exists afterwards, -1 otherwise (errno set): a component that is a file,
 * a permission refusal, or a path longer than PATH_MAX. */
int mh_mkdir_p(const char *path);

#endif
