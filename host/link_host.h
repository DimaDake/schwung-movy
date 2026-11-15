/* movy-host's half of Ableton Link (docs/superpowers/specs/2026-11-15-ableton-
 * link-design.md): it creates the segment movy-link and the engine share.
 * Nothing else: the on/off is movy's own Settings → LINK, which the UI hands
 * the engine, and the Link SDK lives only in movy-link, which launch.sh
 * starts, so movy-host never forks or links it. */
#ifndef MH_LINK_HOST_H
#define MH_LINK_HOST_H

/* Main thread, after the /dev/shm/movy-* sweep and before the engine loads,
 * so the engine finds the segment when it opens. */
void link_host_init(const char *shm_dir);

#endif
