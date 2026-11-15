// SPDX-License-Identifier: GPL-2.0-or-later
//
// movy-link: movy's Ableton Link peer "Movy" (docs/superpowers/specs/
// 2026-11-15-ableton-link-design.md). The Link SDK is GPL and movy is MIT, so
// the SDK lives only in this separate process; movy-host and the engine talk
// to it through /dev/shm/movy-link (movy_link_shm.h).
//
// Started by standalone/launch.sh before movy-host (never by movy-host: a
// fork there stalls audio). Exits when movy-host goes away. Joins the session
// only while schwung's "Movy Link" setting is on.
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

int main() {
    leave_audio_core();
    std::setvbuf(stdout, nullptr, _IOLBF, 0);

    // movy-host creates the segment right after it starts; give it 30 s.
    movy_link_shm_t *s = nullptr;
    for (int i = 0; i < 300 && !(s = open_segment()); i++) std::this_thread::sleep_for(milliseconds(100));
    if (!s) { std::printf("movy-link: no segment from movy-host; exiting\n"); return 0; }
    std::printf("movy-link: attached to movy-host pid %u\n", s->host_pid);

    ableton::LinkAudio link(120.0, "Movy");
    std::vector<std::unique_ptr<ableton::LinkAudioSink>> sinks;
    mlink::Liveness live;
    mlink::Requests req;
    uint32_t tempo_ack = 0, play_ack = 0, sent = 0;
    bool on = false;

    for (;;) {
        auto now = link.clock().micros();
        uint64_t now_us = (uint64_t)now.count();
        bool pid_ok = kill((pid_t)s->host_pid, 0) == 0 || errno == EPERM;
        if (!live.alive(mlink::ld(s->heartbeat, mlink::ACQ), now_us, pid_ok)) {
            std::printf("movy-link: movy-host gone; exiting\n");
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
            uint32_t mask = 0;
            for (int ch = 0; ch < MOVY_LINK_CHANNELS; ch++) {
                auto &sink = *sinks[ch];
                bool listened = false;
                mlink::drain(&s->ring[ch], [&](const movy_link_block_t &b) {
                    ableton::LinkAudioSink::BufferHandle h(sink);
                    if (!h) return false;
                    std::copy(b.lr, b.lr + MOVY_LINK_FRAMES * 2, h.samples);
                    double beat = st.beatAtTime(microseconds(b.play_time_us), 4.0);
                    h.commit(st, beat, 4.0, MOVY_LINK_FRAMES, 2, 44100);
                    listened = true;
                    sent++;
                    return true;
                });
                if (!listened) {
                    // Nothing waited, so ask the sink directly whether anyone listens.
                    ableton::LinkAudioSink::BufferHandle h(sink);
                    listened = bool(h);
                }
                mask = mlink::with_bit(mask, ch, listened);
            }
            mlink::st(s->subscribed, mask, mlink::REL);
            mlink::publish(s, mlink::Snapshot{(uint32_t)link.numPeers(), st.tempo(), st.beatAtTime(now, 4.0),
                                              now_us, st.isPlaying(), (uint64_t)st.timeForIsPlaying().count(),
                                              tempo_ack, play_ack});
            s->sent = sent;
        }
        mlink::st(s->link_alive, s->link_alive + 1, mlink::RLX);
        std::this_thread::sleep_for(milliseconds(1));
    }
    sinks.clear();
    link.enable(false);
    return 0;
}
