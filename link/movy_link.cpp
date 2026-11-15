// SPDX-License-Identifier: GPL-2.0-or-later
//
// movy-link: movy's Ableton Link peer "Movy" (docs/superpowers/specs/
// 2026-11-15-ableton-link-design.md). The Link SDK is GPL and movy is MIT, so
// the SDK lives only in this separate process; movy-host and the engine talk
// to it through /dev/shm/movy-link (movy_link_shm.h).
//
// Started by standalone/launch.sh before movy-host (never by movy-host: a
// fork there stalls audio). Exits when movy-host goes away. Joins the session
// only while movy's Settings → LINK is on (the engine's `enabled`).
//
// Derived from schwung's src/host/link_subscriber.cpp publisher half.

#include <ableton/LinkAudio.hpp>

#include <fcntl.h>
#include <sched.h>
#include <signal.h>
#include <sys/mman.h>
#include <unistd.h>

#include <cerrno>
#include <chrono>
#include <cstdio>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "link_rings.hpp"

using namespace std::chrono;

static std::string channel_name(int ch) {
    if (ch < MOVY_LINK_CH_SEND0) return "Movy " + std::to_string(ch + 1);
    if (ch < MOVY_LINK_CH_MASTER) return "Movy Send " + std::to_string(ch - MOVY_LINK_CH_SEND0 + 1);
    return "Movy Master";
}

static movy_link_shm_t *open_segment() {
    int fd = shm_open(MOVY_LINK_SHM, O_RDWR, 0);
    if (fd < 0) return nullptr;
    void *p = mmap(nullptr, sizeof(movy_link_shm_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) return nullptr;
    auto *s = static_cast<movy_link_shm_t *>(p);
    if (!mlink::valid(s)) { munmap(p, sizeof *s); return nullptr; }
    return s;
}

static void leave_audio_core() {
#ifdef __linux__
    // Core 3 is movy-host's audio thread; the render lanes outrank us anyway.
    cpu_set_t set;
    CPU_ZERO(&set);
    for (int c = 0; c < 3; c++) CPU_SET(c, &set);
    sched_setaffinity(0, sizeof set, &set);
#endif
}

// A block is 2.9 ms and a ring holds 93 ms: waking every 2 ms keeps up with
// one or two blocks per sink per wake, and adds at most 2 ms on the way to Live.
static constexpr int LOOP_MS = 2;
// How often an idle sink is asked whether someone subscribed: 50 ms.
static constexpr unsigned LISTEN_EVERY = 25;

static bool pid_alive(uint32_t pid) {
    return pid && (kill((pid_t)pid, 0) == 0 || errno == EPERM);
}

// The segment of a LIVE movy-host. launch.sh starts us just before movy-host,
// so the first segment we can open may still be the previous movy-host's
// (its sweep has not run yet): one whose pid is gone is skipped, not joined.
static movy_link_shm_t *wait_for_host() {
    for (int i = 0; i < 300; i++) {
        if (movy_link_shm_t *s = open_segment()) {
            if (pid_alive(s->host_pid)) return s;
            munmap(s, sizeof *s);
        }
        std::this_thread::sleep_for(milliseconds(100));
    }
    return nullptr;
}

// One movy-host's lifetime: returns once it is gone, with Link switched off.
static void serve(ableton::LinkAudio &link, movy_link_shm_t *s) {
    std::vector<std::unique_ptr<ableton::LinkAudioSink>> sinks;
    mlink::Liveness live;
    mlink::Requests req;
    uint32_t tempo_ack = 0, play_ack = 0, sent = 0, mask = 0;
    bool on = false;
    unsigned loops = 0;

    for (;;) {
        // Asking a sink whether anyone listens is the idle cost: with nobody
        // subscribed it was 6.75 % of a core at every loop (device, 2026-11-15).
        const bool ask = loops++ % LISTEN_EVERY == 0;
        auto now = link.clock().micros();
        uint64_t now_us = (uint64_t)now.count();
        if (!live.alive(mlink::ld(s->heartbeat, mlink::ACQ), now_us, pid_alive(s->host_pid))) {
            std::printf("movy-link: movy-host %u gone\n", s->host_pid);
            break;
        }
        bool want = mlink::ld(s->enabled, mlink::ACQ) != 0;

        if (want && !on) {
            // Propose movy's tempo; a session that already exists wins (Link).
            auto st = link.captureAppSessionState();
            st.setTempo(mlink::ld(s->movy_bpm_x100, mlink::RLX) / 100.0, now);
            link.commitAppSessionState(st);
            link.enableStartStopSync(true);
            link.enable(true);
            link.enableLinkAudio(true);
            for (int ch = 0; ch < MOVY_LINK_CHANNELS; ch++)
                sinks.push_back(std::make_unique<ableton::LinkAudioSink>(link, channel_name(ch), MOVY_LINK_FRAMES * 2));
            // Requests made before we were on are history, not commands.
            req.tempo_seen = tempo_ack = mlink::ld(s->tempo_req_seq, mlink::ACQ);
            req.play_seen = play_ack = mlink::ld(s->play_req_seq, mlink::ACQ);
            on = true;
            std::printf("movy-link: on, %d channels\n", MOVY_LINK_CHANNELS);
        } else if (!want && on) {
            sinks.clear();
            link.enableLinkAudio(false);
            link.enable(false);
            mask = 0;
            mlink::st(s->subscribed, 0u, mlink::REL);
            mlink::publish(s, mlink::Snapshot{0, 0, 0, now_us, false, 0, tempo_ack, play_ack});
            on = false;
            std::printf("movy-link: off\n");
        }

        if (on) {
            double bpm;
            if (req.tempo(s, &bpm)) {
                auto st = link.captureAppSessionState();
                st.setTempo(bpm, now);
                link.commitAppSessionState(st);
                tempo_ack = req.tempo_seen;
            }
            bool playing;
            uint64_t at;
            if (req.play(s, &playing, &at)) {
                auto st = link.captureAppSessionState();
                if (playing) st.setIsPlayingAndRequestBeatAtTime(true, microseconds(at), 0.0, 4.0);
                else st.setIsPlaying(false, microseconds(at));
                link.commitAppSessionState(st);
                play_ack = req.play_seen;
            }

            auto st = link.captureAppSessionState();
            for (int ch = 0; ch < MOVY_LINK_CHANNELS; ch++) {
                auto &sink = *sinks[ch];
                enum { NONE, SENT, REFUSED } got = NONE;
                mlink::drain(&s->ring[ch], [&](const movy_link_block_t &b) {
                    ableton::LinkAudioSink::BufferHandle h(sink);
                    if (!h) { got = REFUSED; return false; }
                    std::copy(b.lr, b.lr + MOVY_LINK_FRAMES * 2, h.samples);
                    double beat = st.beatAtTime(microseconds(b.play_time_us), 4.0);
                    h.commit(st, beat, 4.0, MOVY_LINK_FRAMES, 2, 44100);
                    got = SENT;
                    sent++;
                    return true;
                });
                bool listened;
                if (got != NONE) listened = got == SENT;
                // An empty ring says nothing (the engine only fills subscribed
                // ones): ask the sink every LISTEN_EVERY loops, else keep the bit.
                else if (ask) listened = bool(ableton::LinkAudioSink::BufferHandle(sink));
                else listened = (mask >> ch) & 1;
                mask = mlink::with_bit(mask, ch, listened);
            }
            mlink::st(s->subscribed, mask, mlink::REL);
            mlink::publish(s, mlink::Snapshot{(uint32_t)link.numPeers(), st.tempo(), st.beatAtTime(now, 4.0),
                                              now_us, st.isPlaying(), (uint64_t)st.timeForIsPlaying().count(),
                                              tempo_ack, play_ack});
            s->sent = sent;
        }
        mlink::st(s->link_alive, s->link_alive + 1, mlink::RLX);
        std::this_thread::sleep_for(milliseconds(LOOP_MS));
    }
    sinks.clear();
    link.enableLinkAudio(false);
    link.enable(false);
}

int main() {
    leave_audio_core();
    std::setvbuf(stdout, nullptr, _IOLBF, 0);
    ableton::LinkAudio link(120.0, "Movy");
    // A restarted movy-host (the harness, a Tools reopen) makes a new
    // segment: serve that one too. No live movy-host for 30 s: done.
    while (movy_link_shm_t *s = wait_for_host()) {
        std::printf("movy-link: attached to movy-host pid %u\n", s->host_pid);
        serve(link, s);
        munmap(s, sizeof *s);
    }
    std::printf("movy-link: no movy-host; exiting\n");
    return 0;
}
