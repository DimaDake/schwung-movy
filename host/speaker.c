#include <stdio.h>
#include <string.h>

#include "features.h"
#include "log.h"
#include "shadow_constants.h"
#include "speaker.h"
#include "speaker_eq.h"

/* Same cadence as mirror.c: ~0.5 s, a stat() unless the file changed. */
#define POLL_TICKS 64
#define CC_LINE_OUT_DETECT 115   /* shadow_midi.h; 0 = speaker, 127 = jack */

static speaker_eq_t g_eq = SPEAKER_EQ_INIT;   /* audio thread only, after init */
static int g_mode;                            /* UI thread writes, audio thread reads */
static int g_engaged;                         /* audio thread writes, UI thread logs */
static int g_seen = -1;                       /* last CC 115 value: audio writes, UI persists */
static features_file_t g_features;
static char g_jack_path[256];

int speaker_mode_parse(const char *json) {
    const char *v = features_value(json, "speaker_eq");
    if (!v) return SPEAKER_EQ_MODE_AUTO;
    while (*v == '"') v++;
    if (strncmp(v, "off", 3) == 0) return SPEAKER_EQ_MODE_OFF;
    if (strncmp(v, "on", 2) == 0) return SPEAKER_EQ_MODE_ON;
    return SPEAKER_EQ_MODE_AUTO;
}

int speaker_engaged(void) { return __atomic_load_n(&g_engaged, __ATOMIC_RELAXED); }

static void read_setting(void) {
    static char buf[16384];
    if (!features_read_if_changed(&g_features, buf, sizeof buf)) return;
    int mode = speaker_mode_parse(buf);
    static const char *names[] = { "auto", "off", "on" };
    if (mode != __atomic_load_n(&g_mode, __ATOMIC_RELAXED)) mh_log("speaker eq: Spkr EQ %s", names[mode]);
    __atomic_store_n(&g_mode, mode, __ATOMIC_RELAXED);
}

void speaker_init(const char *features_path, const char *jack_state_path) {
    snprintf(g_jack_path, sizeof g_jack_path, "%s", jack_state_path);
    speaker_eq_init(&g_eq, 44100.0f);
    speaker_eq_restart_clock(&g_eq);
    features_open(&g_features, features_path);
    read_setting();
}

void speaker_poll(int tick) {
    static int saved = -1, logged_engaged = 0;
    int seen = __atomic_load_n(&g_seen, __ATOMIC_ACQUIRE);
    if (seen >= 0 && seen != saved) {
        saved = seen;
        mh_log("speaker eq: jack reports %s (CC 115 = %d)", seen == 0 ? "the speaker" : "a cable", seen);
        FILE *f = fopen(g_jack_path, "w");
        if (f) { fprintf(f, "%d\n", seen); fclose(f); }
    }
    int on = speaker_engaged();
    if (on != logged_engaged) { logged_engaged = on; mh_log("speaker eq: %s", on ? "engaged" : "bypassed"); }
    if (tick % POLL_TICKS == 0) read_setting();
}

void speaker_in(const uint8_t pkt[4]) {
    /* Cable 0, CIN 0xB, a CC 115: the jack report, as the shim scans it. */
    if (pkt[0] != 0x0B || (pkt[1] & 0xF0) != 0xB0 || pkt[2] != CC_LINE_OUT_DETECT) return;
    speaker_eq_on_jack(&g_eq, pkt[3], 1);
    __atomic_store_n(&g_seen, pkt[3], __ATOMIC_RELEASE);
}

void speaker_process(int16_t *lr, int frames) {
    int mode = __atomic_load_n(&g_mode, __ATOMIC_RELAXED);
    int on = mode == SPEAKER_EQ_MODE_OFF ? 0 : mode == SPEAKER_EQ_MODE_ON ? 1 : speaker_eq_speaker_stable(&g_eq);
    __atomic_store_n(&g_engaged, on, __ATOMIC_RELAXED);
    if (on) speaker_eq_process(&g_eq, lr, frames);
}
