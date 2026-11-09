/* Real-time scheduling for movy-host's own threads (see heal/heal.c). Root
 * runs (the dev stack restart) get it directly; ableton runs ask bin/heal.
 * Missing helper → degraded, logged, and `rt=other` on the test bus. */
#ifndef MH_RT_H
#define MH_RT_H

#include <sys/resource.h>

/* Whether rt_init asks bin/heal: memory did not lock, or the address space is
 * capped. Move's launcher caps it at 1.66 GiB, and a fork-mode module (osirus,
 * the Virus) forks its emulator from movy-host, which inherits the cap AND all
 * of movy-host's mappings: ~830 MB of emulator on top of movy-host's 883 MB
 * left six Virus chains dying in bootDSPs. Lifted before any set loads. */
static inline int rt_helper_wanted(int locked, rlim_t address_space) {
    return !locked || address_space != RLIM_INFINITY;
}

/* Allocations this big or bigger are their own mmap (rt_init): a 4-bar loop
 * is ~1.4 MB, and a block this size costs one mapping, nothing per page. */
#define MH_MMAP_THRESHOLD (1 << 20)

void rt_init(void);
/* UI thread, every tick; does real work about once a second, because the
 * engine spawns its render workers lazily (on the first chain configure). */
void rt_poll(void);
/* "fifo70" or "other": the audio thread's policy. */
const char *rt_state(void);

#endif
