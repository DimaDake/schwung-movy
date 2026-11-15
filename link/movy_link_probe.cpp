// SPDX-License-Identifier: GPL-2.0-or-later
//
// movy-link-probe: a second Link peer for the device tests (test-device/
// scenarios/link.ts), run on the same box. Joins the session, does what its
// flags say, prints one parseable line per fact, leaves.
//
//   --wait <s>            stay this long (default 3)
//   --tempo <bpm>         propose a session tempo
//   --play | --stop       Start/Stop Sync
//   --subscribe <name>    count buffers from peer Movy's channel <name>
//   --subscribe-n <n>     subscribe to Movy's first n channels (cost sweeps)
//
// Output: "peers N", "channel <name>" per Movy channel, "tempo X",
// "playing 0|1", "frames F peak P" (with --subscribe).

#include <ableton/LinkAudio.hpp>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using namespace std::chrono;

int main(int argc, char **argv) {
    double wait = 3, tempo = 0;
    int play = -1;
    std::string sub;
    int sub_n = 0;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--wait" && i + 1 < argc) wait = std::atof(argv[++i]);
        else if (a == "--tempo" && i + 1 < argc) tempo = std::atof(argv[++i]);
        else if (a == "--play") play = 1;
        else if (a == "--stop") play = 0;
        else if (a == "--subscribe" && i + 1 < argc) sub = argv[++i];
        else if (a == "--subscribe-n" && i + 1 < argc) sub_n = std::atoi(argv[++i]);
        else { std::fprintf(stderr, "movy-link-probe: unknown argument %s\n", a.c_str()); return 2; }
    }

    ableton::LinkAudio link(120.0, "Probe");
    link.enableStartStopSync(true);
    link.enable(true);
    link.enableLinkAudio(true);
    // A peer must announce a channel of its own before others answer its
    // channel requests (schwung link_subscriber.cpp's "Schwung-Ack").
    ableton::LinkAudioSink ack(link, "Probe-Ack", 256);

    // Let the session find Movy before acting on it.
    for (int i = 0; i < 40 && link.numPeers() == 0; i++) std::this_thread::sleep_for(milliseconds(100));
    std::this_thread::sleep_for(milliseconds(500));

    if (tempo > 0) {
        auto st = link.captureAppSessionState();
        st.setTempo(tempo, link.clock().micros());
        link.commitAppSessionState(st);
    }
    if (play >= 0) {
        auto st = link.captureAppSessionState();
        if (play) st.setIsPlayingAndRequestBeatAtTime(true, link.clock().micros(), 0.0, 4.0);
        else st.setIsPlaying(false, link.clock().micros());
        link.commitAppSessionState(st);
    }

    std::atomic<long> frames{0};
    std::atomic<int> peak{0};
    std::unique_ptr<ableton::LinkAudioSource> source;
    if (!sub.empty()) {
        for (int i = 0; i < 30 && !source; i++) {
            for (const auto &ch : link.channels()) {
                if (ch.peerName == "Movy" && ch.name == sub) {
                    source = std::make_unique<ableton::LinkAudioSource>(link, ch.id,
                        [&](ableton::LinkAudioSource::BufferHandle h) {
                            frames += (long)h.info.numFrames;
                            for (size_t s = 0; s < h.info.numFrames * h.info.numChannels; s++) {
                                int v = std::abs((int)h.samples[s]);
                                if (v > peak) peak = v;
                            }
                        });
                }
            }
            if (!source) std::this_thread::sleep_for(milliseconds(100));
        }
        if (!source) std::printf("no-channel %s\n", sub.c_str());
    }

    std::vector<std::unique_ptr<ableton::LinkAudioSource>> many;
    for (int i = 0; i < 30 && (int)many.size() < sub_n; i++) {
        for (const auto &ch : link.channels())
            if (ch.peerName == "Movy" && (int)many.size() < sub_n)
                many.push_back(std::make_unique<ableton::LinkAudioSource>(link, ch.id,
                    [&](ableton::LinkAudioSource::BufferHandle h) { frames += (long)h.info.numFrames; }));
        if ((int)many.size() < sub_n) { many.clear(); std::this_thread::sleep_for(milliseconds(100)); }
    }

    std::this_thread::sleep_for(milliseconds((long)(wait * 1000)));

    std::printf("peers %zu\n", link.numPeers());
    for (const auto &ch : link.channels())
        if (ch.peerName == "Movy") std::printf("channel %s\n", ch.name.c_str());
    auto st = link.captureAppSessionState();
    std::printf("tempo %.2f\n", st.tempo());
    std::printf("playing %d\n", st.isPlaying() ? 1 : 0);
    if (!sub.empty() || sub_n) std::printf("frames %ld peak %d sources %zu\n", frames.load(), peak.load(), many.size() + (source ? 1 : 0));
    many.clear();
    std::fflush(stdout);
    source.reset();
    link.enable(false);
    return 0;
}
