/* The one segment movy-host, the engine (dsp.so) and movy-link share.
 *
 * Three writers, each owning its own fields (no field has two writers):
 *   movy-host  host_pid, magic, version (it creates the segment)
 *   engine     enabled (Settings → LINK), heartbeat, movy_bpm_x100, the
 *              *_req_* requests, ring[].write
 *   movy-link  the snapshot (snap_seq .. play_ack_seq), subscribed,
 *              link_alive, sent, ring[].read
 *
 * The snapshot is a seqlock: movy-link makes snap_seq odd, writes, makes it
 * even. The engine copies it and retries on an odd or changed seq.
 *
 * Every time is microseconds on CLOCK_MONOTONIC_RAW, the clock the Link SDK
 * uses on Linux, so the engine never needs an SDK call to read the timeline.
 *
 * The layout is pinned by literal offsets in host/tests/test_link_shm_abi.c and
 * engine/crates/movy-dsp/src/link_shm.rs; change all three together and bump
 * MOVY_LINK_VERSION. */
#ifndef MOVY_LINK_SHM_H
#define MOVY_LINK_SHM_H

#include <stdint.h>

#define MOVY_LINK_SHM      "/movy-link"
#define MOVY_LINK_MAGIC    0x4B4E4C4Du   /* "MLNK" */
#define MOVY_LINK_VERSION  1u
#define MOVY_LINK_CHANNELS 20            /* 16 tracks, 3 sends, master */
#define MOVY_LINK_CH_SEND0 16
#define MOVY_LINK_CH_MASTER 19
#define MOVY_LINK_FRAMES   128
#define MOVY_LINK_RING     32            /* blocks per channel, ~93 ms */

typedef struct {
    uint64_t play_time_us;               /* when its first sample leaves Move */
    uint64_t frame;                      /* engine block counter */
    int16_t  lr[MOVY_LINK_FRAMES * 2];   /* interleaved stereo */
} movy_link_block_t;

/* SPSC: the engine advances write, movy-link advances read. Full = the block
 * is dropped and counted; the audio thread never waits. */
typedef struct {
    uint32_t write, read, drops, pad;
    movy_link_block_t b[MOVY_LINK_RING];
} movy_link_ring_t;

typedef struct {
    uint32_t magic, version;
    uint32_t enabled, host_pid;
    uint64_t heartbeat;
    uint32_t movy_bpm_x100;
    uint32_t tempo_req_seq, tempo_req_bpm_x100;
    uint32_t play_req_seq, play_req_playing, pad0;
    uint64_t play_req_at_us;
    uint32_t snap_seq, peers;
    double   tempo, beat_anchor;
    uint64_t time_anchor_us;
    uint32_t is_playing, tempo_ack_seq;
    uint64_t play_change_us;
    uint32_t play_ack_seq, subscribed;
    uint32_t link_alive, sent;
    movy_link_ring_t ring[MOVY_LINK_CHANNELS];
} movy_link_shm_t;

#endif
