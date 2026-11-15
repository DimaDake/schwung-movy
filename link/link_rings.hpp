// SPDX-License-Identifier: GPL-2.0-or-later
//
// movy-link's side of the segment (movy_link_shm.h) without the Link SDK, so
// it is tested on the host: draining the engine's rings, telling whether
// movy-host is still there, noticing new requests, publishing the snapshot.
#ifndef MOVY_LINK_RINGS_HPP
#define MOVY_LINK_RINGS_HPP

#include <atomic>
#include <cstdint>
#include <string>

extern "C" {
#include "movy_link_shm.h"
}

namespace mlink {

// __atomic builtins, not std::atomic_ref: the fields are plain C, and the
// macOS libc++ the host tests build with has no atomic_ref.
template <class T> inline T ld(T &x, int mo) { return __atomic_load_n(&x, mo); }
template <class T> inline void st(T &x, T v, int mo) { __atomic_store_n(&x, v, mo); }
constexpr int ACQ = __ATOMIC_ACQUIRE, REL = __ATOMIC_RELEASE, RLX = __ATOMIC_RELAXED;

inline bool valid(movy_link_shm_t *s) {
    return ld(s->magic, ACQ) == MOVY_LINK_MAGIC && s->version == MOVY_LINK_VERSION;
}

inline uint32_t with_bit(uint32_t mask, int ch, bool on) {
    return on ? mask | (1u << ch) : mask & ~(1u << ch);
}

// Hands each waiting block to `emit` oldest first; `emit` returns false when
// the channel has no listener, and then the rest is discarded rather than
// left to go stale. Returns the blocks emitted.
template <class F> int drain(movy_link_ring_t *r, F &&emit) {
    uint32_t w = ld(r->write, ACQ);
    uint32_t rd = ld(r->read, RLX);
    if (w - rd > MOVY_LINK_RING) rd = w - MOVY_LINK_RING;   // never more than the ring holds
    int n = 0;
    for (; rd != w; rd++) {
        if (!emit(r->b[rd % MOVY_LINK_RING])) { rd = w; break; }
        n++;
    }
    st(r->read, rd, REL);
    return n;
}

// movy-host is alive while its pid exists and the engine's heartbeat moved
// in the last 2 s. A movy-host that restarts makes a NEW segment, so the old
// one's heartbeat stops and this helper exits; launch.sh starts the next.
struct Liveness {
    uint64_t last_hb = 0, last_change_us = 0;
    bool seen = false;
    bool alive(uint64_t hb, uint64_t now_us, bool pid_ok) {
        if (!seen || hb != last_hb) { seen = true; last_hb = hb; last_change_us = now_us; }
        // Before the first beat movy-host is still loading the engine.
        uint64_t limit = hb == 0 ? 30'000'000 : 2'000'000;
        return pid_ok && now_us - last_change_us < limit;
    }
};

struct Requests {
    uint32_t tempo_seen = 0, play_seen = 0;
    bool tempo(movy_link_shm_t *s, double *bpm) {
        uint32_t seq = ld(s->tempo_req_seq, ACQ);
        if (seq == tempo_seen) return false;
        tempo_seen = seq;
        *bpm = ld(s->tempo_req_bpm_x100, RLX) / 100.0;
        return true;
    }
    bool play(movy_link_shm_t *s, bool *playing, uint64_t *at_us) {
        uint32_t seq = ld(s->play_req_seq, ACQ);
        if (seq == play_seen) return false;
        play_seen = seq;
        *playing = ld(s->play_req_playing, RLX) != 0;
        *at_us = ld(s->play_req_at_us, RLX);
        return true;
    }
};

struct Snapshot {
    uint32_t peers;
    double tempo, beat_anchor;
    uint64_t time_anchor_us;
    bool is_playing;
    uint64_t play_change_us;
    uint32_t tempo_ack_seq, play_ack_seq;
};

inline void publish(movy_link_shm_t *s, const Snapshot &v) {
    uint32_t q = ld(s->snap_seq, RLX);
    st(s->snap_seq, q + 1, RLX);   // odd: writing
    std::atomic_thread_fence(std::memory_order_release);
    s->peers = v.peers;
    s->tempo = v.tempo;
    s->beat_anchor = v.beat_anchor;
    s->time_anchor_us = v.time_anchor_us;
    s->is_playing = v.is_playing;
    s->play_change_us = v.play_change_us;
    s->tempo_ack_seq = v.tempo_ack_seq;
    s->play_ack_seq = v.play_ack_seq;
    st(s->snap_seq, q + 2, REL);   // even: done
}

/**
 * The Link Audio name of channel [ch]. Track numbers are zero-padded because
 * Live (and any peer listing by name) sorts channels as TEXT: "Movy 11" landed
 * between "Movy 1" and "Movy 2". Sorted, the names are in channel order.
 */
inline std::string channel_name(int ch) {
    if (ch < MOVY_LINK_CH_SEND0) return std::string(ch < 9 ? "Movy 0" : "Movy ") + std::to_string(ch + 1);
    if (ch < MOVY_LINK_CH_MASTER) return "Movy Send " + std::to_string(ch - MOVY_LINK_CH_SEND0 + 1);
    return "Movy Master";
}

}  // namespace mlink

#endif
