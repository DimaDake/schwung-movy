/* /dev/ablspi0.0, the boot-select.c way: exclusive open (a second owner gets
 * EBUSY, so movy-host can never drive SPI beside Move), mmap of the 4 KiB
 * page, and one WAIT_AND_SEND per 128-frame audio block. */
#ifndef MH_SPI_H
#define MH_SPI_H

#include <stdint.h>

typedef struct { int fd; uint8_t *map; } mh_spi_t;

int  spi_open(mh_spi_t *s);           /* 0 ok, -errno */
void spi_pump(mh_spi_t *s);           /* blocks until the XMOS has the frame */
/* The display is a PULL protocol: answer the slice the XMOS asks for. */
void spi_serve_display(uint8_t *map, const uint8_t packed[1024]);
/* Blank the screen through the same handshake, then release the device. */
void spi_close(mh_spi_t *s);

#endif
