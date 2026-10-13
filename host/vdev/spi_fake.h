/* The virtual device's mailbox (spi_fake.c). The page is the hardware's
 * layout (schwung_spi_lib.h); the two fields below sit in its unused gap,
 * between the audio in and the sysinfo word, for whoever watches the file. */
#ifndef MH_SPI_FAKE_H
#define MH_SPI_FAKE_H

/* Not /dev/shm/movy-*: movy-host sweeps that prefix as stale at start. */
#define VSPI_DEFAULT_PATH "/dev/shm/vspi-mailbox"
#define VSPI_OFF_FRAMES 3072   /* uint64: transfers so far */
#define VSPI_OFF_PEAK   3080   /* int16: peak |sample| of the last block out */

const char *vspi_path(void);

#endif
