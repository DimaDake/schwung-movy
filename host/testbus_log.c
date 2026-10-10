/* LOG_SEQ / LOG_TAIL (docs/standalone/testbus.md): the bus's view of the log
 * ring, so a before/after check is an exact delta with no ssh. */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "log_ring.h"
#include "testbus.h"

int testbus_log_seq(tb_reply_t *o) {
    snprintf(o->buf, (size_t)o->cap, "OK seq=%u", log_ring_seq());
    return 0;
}

/* `LOG_TAIL <from> [<substring>]`: the lines after `from`, filtered by a
 * literal substring of "[src] text" (debug.log's shape, so a pattern that
 * greps there matches here). A reply is bounded by the bus line buffer; when
 * it fills, the header says more=1 and seq= is where to continue from. */
int testbus_log_tail(const char *args, tb_reply_t *o) {
    char *end;
    unsigned long from = strtoul(args, &end, 10);
    if (end == args) { snprintf(o->buf, (size_t)o->cap, "ERR LOG_TAIL: usage LOG_TAIL <from_seq> [<substring>]"); return 0; }
    const char *pat = *end == ' ' ? end + 1 : NULL;
    if (pat && !*pat) pat = NULL;

    uint32_t head = log_ring_seq(), s = (uint32_t)from + 1, lost = 0, last = (uint32_t)from;
    if (head >= LOG_RING_CAP && s < head - LOG_RING_CAP + 1) {
        lost = head - LOG_RING_CAP + 1 - s;
        s = head - LOG_RING_CAP + 1;
    }
    /* Body first, header after: the count is only known at the end. */
    const int hdr = 96;
    char *body = o->buf + hdr, line[LOG_RING_SRC + LOG_RING_TEXT + 4];
    int used = 0, room = o->cap - hdr - 8, count = 0, more = 0;
    log_line_t l;
    for (; s <= head; s++) {
        int r = log_ring_read(s, &l);
        if (r == 0) break;            /* still being written: stop in order */
        if (r < 0) { lost++; last = s; continue; }
        snprintf(line, sizeof line, "[%s] %s", l.src, l.text);
        last = s;
        if (pat && !strstr(line, pat)) continue;
        for (char *c = line; *c; c++) if (*c == '\n') *c = ' ';
        int n = snprintf(body + used, (size_t)(room - used), "\nLN %u %s", s, line);
        if (n >= room - used) { more = 1; last = s - 1; body[used] = '\0'; break; }
        used += n;
        count++;
    }
    char h[hdr];
    int hl = snprintf(h, sizeof h, "OK count=%d seq=%u%s", count, last, more ? " more=1" : "");
    if (lost) hl += snprintf(h + hl, sizeof h - (size_t)hl, " lost=%u", lost);
    memmove(o->buf + hl, body, (size_t)used);
    memcpy(o->buf, h, (size_t)hl);
    memcpy(o->buf + hl + used, "\nEND", 5);
    return 0;
}
