/* movy-host's half of Ableton Link (docs/superpowers/specs/2026-11-15-ableton-
 * link-design.md): it creates the segment movy-link and the engine share, and
 * publishes schwung's "Movy Link" setting (features.json movy_link_enabled,
 * default off) into it. Nothing else: the Link SDK lives only in movy-link,
 * which launch.sh starts, so movy-host never forks or links it. */
#ifndef MH_LINK_HOST_H
#define MH_LINK_HOST_H

/* Main thread, after the /dev/shm/movy-* sweep and before the engine loads,
 * so the engine finds the segment when it opens. */
void link_host_init(const char *shm_dir, const char *features_path);
/* UI thread, every tick: re-reads the setting when its file changed. */
void link_host_poll(int tick);

/* Exposed for the tests. */
int link_flag_parse(const char *json);

#endif
