#define _GNU_SOURCE
#include <arpa/inet.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include "log.h"
#include "movy_host.h"
#include "testbus.h"

#define PORT 47777
#define LINE_CAP 65536

static int g_listen = -1;

static int send_all(int fd, const char *s, size_t n) {
    while (n) {
        ssize_t w = send(fd, s, n, MSG_NOSIGNAL);
        if (w <= 0) return -1;
        s += w;
        n -= (size_t)w;
    }
    return 0;
}

/* One client at a time, as schwung-testd: a second waits in the backlog. */
static void serve(int fd) {
    static char line[LINE_CAP], out[LINE_CAP * 2 + 64];
    tb_reply_t r = { out, sizeof out - 2 };
    int len = 0;
    for (;;) {
        ssize_t n = recv(fd, line + len, (size_t)(LINE_CAP - 1 - len), 0);
        if (n <= 0) return;
        len += (int)n;
        char *nl;
        while ((nl = memchr(line, '\n', (size_t)len))) {
            *nl = '\0';
            if (nl > line && nl[-1] == '\r') nl[-1] = '\0';
            int close_after = testbus_handle(line, &r);
            size_t ol = strlen(out);
            out[ol++] = '\n';
            if (send_all(fd, out, ol) || close_after) return;
            len -= (int)(nl + 1 - line);
            memmove(line, nl + 1, (size_t)len);
        }
        if (len >= LINE_CAP - 1) { send_all(fd, "ERR ?: line too long\n", 21); return; }
    }
}

static void *bus_main(void *arg) {
    pthread_setname_np(pthread_self(), "movy-testbus");
    while (!g_mh_quit) {
        int c = accept(g_listen, NULL, NULL);
        if (c < 0) continue;
        serve(c);
        close(c);
    }
    return NULL;
}

void testbus_start(void) {
    char flag[300];
    struct stat st;
    snprintf(flag, sizeof flag, "%s/testbus", g_mh_module_dir);
    const char *env = getenv("MOVY_TESTBUS");
    if (!(env && !strcmp(env, "1")) && stat(flag, &st) != 0) return;
    const char *bind_to = getenv("MOVY_TESTBUS_BIND");
    if (!bind_to && stat(flag, &st) == 0) bind_to = "0.0.0.0";   /* the harness's file form */
    g_listen = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
    int one = 1;
    setsockopt(g_listen, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(PORT) };
    inet_pton(AF_INET, bind_to ? bind_to : "127.0.0.1", &a.sin_addr);
    if (bind(g_listen, (struct sockaddr *)&a, sizeof a) || listen(g_listen, 4)) {
        mh_log("testbus: cannot listen on %s:%d (schwung-testd running?)", bind_to ? bind_to : "127.0.0.1", PORT);
        close(g_listen);
        return;
    }
    pthread_t t;
    pthread_create(&t, NULL, bus_main, NULL);
    pthread_detach(t);
    mh_log("testbus: listening on %s:%d", bind_to ? bind_to : "127.0.0.1", PORT);
}
