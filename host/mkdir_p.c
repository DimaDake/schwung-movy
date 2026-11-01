#include <errno.h>
#include <limits.h>
#include <string.h>
#include <sys/stat.h>

#include "mkdir_p.h"

static int make_one(const char *dir) {
    if (mkdir(dir, 0755) == 0) return 0;
    if (errno != EEXIST) return -1;
    /* EEXIST is only success when what exists is a directory. */
    struct stat st;
    if (stat(dir, &st) != 0) return -1;
    if (!S_ISDIR(st.st_mode)) { errno = ENOTDIR; return -1; }
    return 0;
}

int mh_mkdir_p(const char *path) {
    char buf[PATH_MAX];
    size_t n = path ? strlen(path) : 0;
    if (n == 0) { errno = ENOENT; return -1; }
    if (n >= sizeof buf) { errno = ENAMETOOLONG; return -1; }
    memcpy(buf, path, n + 1);
    while (n > 1 && buf[n - 1] == '/') buf[--n] = '\0';
    for (char *p = buf + 1; *p; p++) {
        if (*p != '/') continue;
        *p = '\0';
        int rc = make_one(buf);
        *p = '/';
        if (rc != 0) return -1;
    }
    return make_one(buf);
}
