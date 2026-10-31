/* schwung's config/features.json, read the way the shim reads it. Two readers
 * (mirror.c's Mirror Display, speaker.c's Spkr EQ) take settings from it, and
 * the manager rewrites it whenever a toggle moves, so each poll is a stat()
 * and the file is read only when its mtime changed. */
#ifndef MH_SETTINGS_FILE_H
#define MH_SETTINGS_FILE_H
#include <stddef.h>
#include <time.h>

typedef struct {
    char path[256];
    struct timespec mtime;
    int read_once;
} features_file_t;

void features_open(features_file_t *f, const char *path);
/* 1 when the text changed since the last call (the first call always counts),
 * with the file's text in buf; an absent file reads as "", schwung's defaults. */
int features_read_if_changed(features_file_t *f, char *buf, size_t cap);
/* The first non-blank character after `"key":`, or NULL when the key is absent.
 * The shim's own strstr reading, so one file means one answer. */
const char *features_value(const char *json, const char *key);
#endif
