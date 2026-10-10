/* Powering the box off, the way Move itself does: com.ableton.system's
 * Power.shutDown on the system bus (SystemDBusService, root, which outlives
 * launch-standalone.sh's kill sweep). /etc/dbus-1/system.d/move.conf lets
 * ableton call it, so no root helper is needed. Called after movy-host has
 * shut down cleanly — the UI saved in onUnload, the engine flushed. */
#ifndef MH_POWER_H
#define MH_POWER_H

/* 1 once the UI confirmed its dialog (host_power_off). */
extern volatile int g_mh_poweroff;

/* Harness mode (the test bus file) only logs what it would run: a test must
 * never turn the box off. */
void power_off_now(void);

#endif
