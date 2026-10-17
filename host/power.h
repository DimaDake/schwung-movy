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
 * never turn the box off. Returns 1 when com.ableton.system accepted the
 * shutdown, which it answers at once: the power goes seconds later. */
int power_off_now(void);

/* Blocks, deaf to SIGTERM/SIGINT/SIGHUP, for up to `seconds`. movy-host must
 * not exit while the box is going down: launch-standalone.sh would restart
 * Move, the boot selector counts that as a boot attempt, and the power cut
 * kills it mid-boot. That is a watchdog strike, and three in a row open
 * schwung's "failed to start" picker on the next boot. Returns only if the
 * power never went, so a failed shutdown still gives Move back. `tick`, when
 * given, is called over and over for the length of the hold and must block for
 * a while each time (the power-off show pumps one SPI frame). */
void power_hold(int seconds, void (*tick)(void *), void *arg);

/* A Move shutdown takes seconds; this only bounds a shutdown that never comes. */
#define MH_POWEROFF_HOLD_S 120

#endif
