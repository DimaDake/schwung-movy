/* movy-host's test bus, protocol v1 (docs/standalone/testbus.md). WP6 carries
 * the subset the minimal transport needs; the rest answers a fixed ERR so a
 * harness asking early fails loudly instead of reading a silent OK. */
#ifndef MH_TESTBUS_H
#define MH_TESTBUS_H

/* Starts the bus thread when MOVY_TESTBUS=1 or <module dir>/testbus exists. */
void testbus_start(void);

/* One request line → reply (without the trailing newline). Returns 1 when the
 * connection should close after the reply (QUIT/EXIT). Exposed for tests. */
typedef struct { char *buf; int cap; } tb_reply_t;
int testbus_handle(const char *line, tb_reply_t *out);

#endif
