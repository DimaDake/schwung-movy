#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "audio_live_shm.h"
#include "log.h"
#include "mirror.h"
#include "surface_live_shm.h"

/* The setting is read every POLL_TICKS UI ticks (~0.5 s), and only by stat()
 * unless the file changed: the manager rewrites it when the toggle moves. */
#define POLL_TICKS 64

static surface_live_shm_t *g_surface;
static surface_live_writer_t g_writer;
static audio_live_shm_t *g_audio;
static int g_sound;                       /* UI thread writes, audio thread reads */
static float g_master = 1.0f;             /* audio thread only: param service + push */
static char g_features[256];
static struct timespec g_features_mtime;

/* Never unlinked and recreated: display-server maps each segment ONCE and
 * never reopens it, so a fresh inode would be invisible to it until it
 * restarted. Re-initialising the old one in place is what the shim does too. */
static void *map_segment(const char *dir, const char *name, size_t size) {
    char path[256];
    snprintf(path, sizeof path, "%s%s", dir, name);
    int fd = open(path, O_RDWR | O_CREAT, 0666);
    if (fd < 0) { mh_log("mirror: cannot open %s; /mirror will not show it", path); return NULL; }
    /* Whichever uid creates it, the shim must be able to open it next. */
    fchmod(fd, 0666);
    struct stat st;
    void *p = MAP_FAILED;
    if (fstat(fd, &st) == 0 && (st.st_size >= (off_t)size || ftruncate(fd, (off_t)size) == 0))
        p = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) { mh_log("mirror: cannot map %s", path); return NULL; }
    return p;
}

/* The shim's own reading of the key, so one features.json means one answer. */
int mirror_flag_parse(const char *json) {
    const char *k = strstr(json, "\"display_mirror_enabled\"");
    const char *c = k ? strchr(k, ':') : NULL;
    if (!c) return 0;
    for (c++; *c == ' ' || *c == '\t' || *c == '\n' || *c == '\r'; c++) {}
    return strncmp(c, "true", 4) == 0;
}

int mirror_sound_on(void) { return __atomic_load_n(&g_sound, __ATOMIC_RELAXED); }

static void read_setting(void) {
    struct stat st;
    if (stat(g_features, &st) != 0) {   /* absent: schwung's default, off */
        g_features_mtime = (struct timespec){ 0, 0 };
        __atomic_store_n(&g_sound, 0, __ATOMIC_RELAXED);
        return;
    }
#ifdef __APPLE__
    struct timespec m = st.st_mtimespec;
#else
    struct timespec m = st.st_mtim;
#endif
    if (m.tv_sec == g_features_mtime.tv_sec && m.tv_nsec == g_features_mtime.tv_nsec) return;
    g_features_mtime = m;
    static char buf[16384];
    FILE *f = fopen(g_features, "r");
    size_t n = f ? fread(buf, 1, sizeof buf - 1, f) : 0;
    if (f) fclose(f);
    buf[n] = '\0';
    int on = mirror_flag_parse(buf);
    if (on != mirror_sound_on()) mh_log("mirror: sound %s (Mirror Display %s)", on ? "streaming" : "off", on ? "on" : "off");
    __atomic_store_n(&g_sound, on, __ATOMIC_RELAXED);
}

void mirror_init(const char *shm_dir, const char *features_path) {
    snprintf(g_features, sizeof g_features, "%s", features_path);
    g_surface = map_segment(shm_dir, SURFACE_LIVE_SHM_NAME, sizeof(surface_live_shm_t));
    if (g_surface) surface_live_init(g_surface, &g_writer);
    g_audio = map_segment(shm_dir, AUDIO_LIVE_SHM_NAME, sizeof(audio_live_shm_t));
    if (g_audio) audio_live_init(g_audio);
    read_setting();
}

void mirror_poll(int tick) {
    if (tick % POLL_TICKS == 0) read_setting();
}

void mirror_out(const uint8_t (*pkts)[4], int n) {
    if (g_surface && n > 0) surface_live_scan_out(g_surface, &g_writer, &pkts[0][0], n * 4);
}

void mirror_in(const uint8_t *midi_in, int bytes) {
    if (g_surface) surface_live_scan_in(g_surface, &g_writer, midi_in, bytes);
}

void mirror_master_volume(const char *val) {
    float g = strtof(val, NULL);
    if (g == g) g_master = g < 0.0f ? 0.0f : g > 1.0f ? 1.0f : g;   /* NaN changes nothing, as in the engine */
}

/* The block arrives AFTER the engine's master volume, but the shim streams
 * the mirror at unity -- Move's mix times a smoothed 1/master, capped at 50x
 * -- so the page plays at one level whatever the knob says. Pushed as it is,
 * a knob near the bottom made every movy recording sound silent. Same
 * smoothing and cap as the shim, so the two hosts' streams match. */
void mirror_audio(const int16_t *lr, int frames) {
    static float smoothed = 1.0f;
    if (!g_audio || !__atomic_load_n(&g_sound, __ATOMIC_RELAXED)) return;
    smoothed += (g_master - smoothed) * 0.1f;
    float inv = smoothed > 0.001f ? 1.0f / smoothed : 1.0f;
    audio_live_push(g_audio, lr, frames, inv > 50.0f ? 50.0f : inv);
}
