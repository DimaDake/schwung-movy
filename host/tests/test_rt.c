/* rt.h: when movy-host asks bin/heal before the audio thread exists. */
#include <stdio.h>

#include "rt.h"

static int fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

/* Move's launcher caps the address space at this (measured on movy-host). */
#define MOVE_CAP ((rlim_t)1782439936)

int main(void) {
    CHECK(rt_helper_wanted(0, RLIM_INFINITY), "memory that did not lock still asks");
    /* The Virus (osirus) emulator is forked from movy-host and inherits its
     * mappings and this cap: six of them died in bootDSPs with movy-host at
     * 883 MB, so the cap is lifted even when memory locked on its own. */
    CHECK(rt_helper_wanted(1, MOVE_CAP), "a capped address space asks, locked or not");
    CHECK(rt_helper_wanted(0, MOVE_CAP), "both at once ask once");
    CHECK(!rt_helper_wanted(1, RLIM_INFINITY), "locked and uncapped: nothing to ask");
    printf("test_rt: %d/%d checks passed\n", checks - fails, checks);
    return fails != 0;
}
