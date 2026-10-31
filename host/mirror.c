#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "audio_live_shm.h"
#include "features.h"
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
static features_file_t g_features;

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
    const char *v = features_value(json, "display_mirror_enabled");
    return v && strncmp(v, "true", 4) == 0;
}

int mirror_sound_on(void) { return __atomic_load_n(&g_sound, __ATOMIC_RELAXED); }

static void read_setting(void) {
    static char buf[16384];
    if (!features_read_if_changed(&g_features, buf, sizeof buf)) return;
    int on = mirror_flag_parse(buf);   /* absent: schwung's default, off */
    if (on != mirror_sound_on()) mh_log("mirror: sound %s (Mirror Display %s)", on ? "streaming" : "off", on ? "on" : "off");
    __atomic_store_n(&g_sound, on, __ATOMIC_RELAXED);
}

void mirror_init(const char *shm_dir, const char *features_path) {
    features_open(&g_features, features_path);
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
