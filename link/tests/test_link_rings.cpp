// movy-link's logic that needs no Link SDK: ring draining, liveness,
// requests and the snapshot seqlock. Host build: scripts/build-link.sh --host-test
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "../link_rings.hpp"

static int fails, checks;
#define CHECK(c, msg) do { checks++; if (!(c)) { fails++; std::printf("  FAIL %s:%d %s\n", __FILE__, __LINE__, msg); } } while (0)

static std::unique_ptr<movy_link_shm_t> segment() {
    auto s = std::make_unique<movy_link_shm_t>();
    std::memset(s.get(), 0, sizeof *s);
    s->magic = MOVY_LINK_MAGIC;
    s->version = MOVY_LINK_VERSION;
    return s;
}

static void push(movy_link_ring_t &r, int16_t v, uint64_t t) {
    auto &b = r.b[r.write % MOVY_LINK_RING];
    b.play_time_us = t;
    for (auto &x : b.lr) x = v;
    r.write++;
}

int main() {
    // version_mismatch_waits
    auto s = segment();
    CHECK(mlink::valid(s.get()), "valid segment");
    s->version = 99;
    CHECK(!mlink::valid(s.get()), "wrong version is not ours");
    s->version = MOVY_LINK_VERSION;
    s->magic = 0;
    CHECK(!mlink::valid(s.get()), "no magic yet: movy-host still creating it");
    s->magic = MOVY_LINK_MAGIC;

    // drain_order
    auto &r = s->ring[3];
    push(r, 1, 100); push(r, 2, 200); push(r, 3, 300);
    std::vector<int> got;
    std::vector<uint64_t> times;
    int n = mlink::drain(&r, [&](const movy_link_block_t &b) { got.push_back(b.lr[0]); times.push_back(b.play_time_us); return true; });
    CHECK(n == 3 && got == std::vector<int>({1, 2, 3}), "oldest first");
    CHECK(times[2] == 300, "times travel with blocks");
    CHECK(r.read == r.write, "ring empty after drain");

    // invalid_handle_discards: a sink nobody listens to drops its backlog
    push(r, 4, 400); push(r, 5, 500);
    n = mlink::drain(&r, [&](const movy_link_block_t &) { return false; });
    CHECK(n == 0 && r.read == r.write, "no listener: discarded, not left to go stale");

    // an overrun ring (consumer stalled) skips to the newest blocks
    for (int i = 0; i < 40; i++) push(r, (int16_t)i, i);
    r.read = r.write - 40;
    got.clear();
    mlink::drain(&r, [&](const movy_link_block_t &b) { got.push_back(b.lr[0]); return true; });
    CHECK(got.size() == MOVY_LINK_RING && got.back() == 39, "overrun keeps the newest RING blocks");

    // mask_follows_listeners
    uint32_t m = 0;
    m = mlink::with_bit(m, 0, true);
    m = mlink::with_bit(m, 19, true);
    m = mlink::with_bit(m, 0, false);
    CHECK(m == (1u << 19), "mask bits");

    // liveness_heartbeat_timeout
    mlink::Liveness live;
    CHECK(live.alive(1, 0, true), "first beat");
    CHECK(live.alive(1, 1'900'000, true), "no new beat for 1.9 s: still alive");
    CHECK(!live.alive(1, 2'100'000, true), "2 s without a beat: gone");
    CHECK(live.alive(2, 2'200'000, true), "beats again");
    CHECK(!live.alive(3, 2'300'000, false), "pid gone: gone at once");

    // a movy-host still booting (no first beat yet) gets 30 s, not 2
    mlink::Liveness boot;
    CHECK(boot.alive(0, 0, true), "boot");
    CHECK(boot.alive(0, 20'000'000, true), "no beat yet at 20 s: still booting");
    CHECK(!boot.alive(0, 31'000'000, true), "never beat in 30 s: gone");

    // requests: a new seq is a new request, once
    mlink::Requests req;
    s->tempo_req_seq = 1; s->tempo_req_bpm_x100 = 13300;
    double bpm = 0;
    CHECK(req.tempo(s.get(), &bpm) && bpm == 133.0, "new tempo request");
    CHECK(!req.tempo(s.get(), &bpm), "same seq is not new");
    s->play_req_seq = 1; s->play_req_playing = 1; s->play_req_at_us = 42;
    bool playing = false; uint64_t at = 0;
    CHECK(req.play(s.get(), &playing, &at) && playing && at == 42, "new play request");
    CHECK(!req.play(s.get(), &playing, &at), "once");

    // the seqlock writer leaves an even seq and the values in place
    mlink::Snapshot snap{2, 128.0, 8.0, 1000, true, 900, 1, 1};
    uint32_t before = s->snap_seq;
    mlink::publish(s.get(), snap);
    CHECK(s->snap_seq == before + 2 && (s->snap_seq & 1) == 0, "seq advanced by two");
    CHECK(s->peers == 2 && s->tempo == 128.0 && s->is_playing == 1 && s->play_change_us == 900, "values");

    std::printf("movy-link rings: %d/%d checks passed\n", checks - fails, checks);
    return fails != 0;
}
