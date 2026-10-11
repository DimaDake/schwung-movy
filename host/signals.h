/* SIGTERM/SIGINT reach movy-host from either door. */
#ifndef MH_SIGNALS_H
#define MH_SIGNALS_H

/* Exit status when movy-host left because it was told to (SIGTERM/SIGINT),
 * not because the user quit. The boot door hands the device to Schwung after
 * a quit but must NOT after a stop: `/etc/init.d/move stop` starting Schwung
 * is the documented boot-target failure (schwung docs/BOOT_TARGETS.md). */
#define MH_RC_TERM 5

/* Installs `on_term` for SIGTERM and SIGINT and UNBLOCKS them. At the boot
 * door every process below MoveLauncher inherits a mask that blocks TERM, INT
 * and USR1 (SigBlk 0x4202, read on the device), and a blocked mask survives
 * fork and exec: the handler alone would never run, a stop would leave SPI
 * held, and the next start would find the device busy. Call it before any
 * thread exists — threads take the caller's mask. */
void mh_signals_install(void (*on_term)(int));

#endif
