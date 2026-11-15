/* The movy-link segment is read by three compilers (C here, Rust in movy-dsp,
 * C++ in movy-link). These literals are the contract; link_shm.rs pins the
 * same numbers, so a field moved on one side fails both suites. */
#include <stddef.h>
#include <stdio.h>
#include "movy_link_shm.h"

#define AT(f, n) _Static_assert(offsetof(movy_link_shm_t, f) == (n), #f)
AT(magic, 0); AT(version, 4); AT(enabled, 8); AT(host_pid, 12); AT(heartbeat, 16);
AT(movy_bpm_x100, 24); AT(tempo_req_seq, 28); AT(tempo_req_bpm_x100, 32);
AT(play_req_seq, 36); AT(play_req_playing, 40); AT(play_req_at_us, 48);
AT(snap_seq, 56); AT(peers, 60); AT(tempo, 64); AT(beat_anchor, 72);
AT(time_anchor_us, 80); AT(is_playing, 88); AT(tempo_ack_seq, 92);
AT(play_change_us, 96); AT(play_ack_seq, 104); AT(subscribed, 108);
AT(link_alive, 112); AT(sent, 116); AT(ring, 120);
_Static_assert(sizeof(movy_link_block_t) == 528, "block");
_Static_assert(sizeof(movy_link_ring_t) == 16912, "ring");
_Static_assert(sizeof(movy_link_shm_t) == 338360, "segment");

int main(void) {
    printf("link shm abi: %zu bytes ok\n", sizeof(movy_link_shm_t));
    return 0;
}
