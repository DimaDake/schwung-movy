/* Real-time scheduling for movy-host's own threads (see heal/heal.c). Root
 * runs (the dev stack restart) get it directly; ableton runs ask bin/heal.
 * Missing helper → degraded, logged, and `rt=other` on the test bus. */
#ifndef MH_RT_H
#define MH_RT_H

void rt_init(void);
/* UI thread, every tick; does real work about once a second, because the
 * engine spawns its render workers lazily (on the first chain configure). */
void rt_poll(void);
/* "fifo70" or "other": the audio thread's policy. */
const char *rt_state(void);

#endif
