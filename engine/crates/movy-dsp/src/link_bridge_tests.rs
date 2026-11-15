use super::*;
use std::alloc::{alloc_zeroed, dealloc, Layout};

/// A segment as movy-host leaves it, on the heap instead of /dev/shm.
struct Seg(*mut LinkShm);
impl Seg {
    fn new() -> Self {
        let p = unsafe { alloc_zeroed(Layout::new::<LinkShm>()) } as *mut LinkShm;
        unsafe {
            (*p).magic = LINK_MAGIC;
            (*p).version = LINK_VERSION;
            (*p).enabled = 1;
        }
        Seg(p)
    }
    fn s(&self) -> &mut LinkShm { unsafe { &mut *self.0 } }
}
impl Drop for Seg {
    fn drop(&mut self) { unsafe { dealloc(self.0 as *mut u8, Layout::new::<LinkShm>()) } }
}

#[test]
fn bridge_without_helper_is_inert() {
    let mut b = LinkBridge::inert();
    let (snap, _, mask) = b.begin_block(12000);
    assert!(!snap.enabled && snap.peers == 0 && mask == 0);
    b.tap(0, &[1; 256]);
    b.finish_block();
    assert_eq!(b.status(), " lk=0 lkp=0 lks=0");
    // A segment with the wrong version is someone else's: inert too.
    let seg = Seg::new();
    seg.s().version = 99;
    assert!(LinkBridge::from_raw(seg.0).shm.is_null());
}

#[test]
fn heartbeat_and_tempo_published() {
    let seg = Seg::new();
    let mut b = LinkBridge::from_raw(seg.0);
    b.begin_block(13300);
    b.begin_block(13300);
    assert_eq!(seg.s().heartbeat, 2);
    assert_eq!(seg.s().movy_bpm_x100, 13300);
}

#[test]
fn snapshot_read_and_torn_seqlock_keeps_last() {
    let seg = Seg::new();
    let mut b = LinkBridge::from_raw(seg.0);
    seg.s().peers = 2;
    seg.s().tempo = 128.0;
    seg.s().snap_seq = 2;
    let (snap, _, _) = b.begin_block(12000);
    assert!(snap.enabled && snap.peers == 2 && snap.tempo == 128.0);
    // movy-link is mid-write (odd seq): the last good copy stands.
    seg.s().snap_seq = 3;
    seg.s().tempo = 0.0;
    let (snap, _, _) = b.begin_block(12000);
    assert_eq!(snap.tempo, 128.0, "torn read discarded");
    // Setting off: no channel is ever tapped.
    seg.s().enabled = 0;
    seg.s().subscribed = 1;
    let (snap, _, mask) = b.begin_block(12000);
    assert!(!snap.enabled && mask == 0);
}

#[test]
fn tap_only_subscribed() {
    let seg = Seg::new();
    seg.s().subscribed = 1 << 3;
    let mut b = LinkBridge::from_raw(seg.0);
    b.begin_block(12000);
    b.tap(0, &[7; 256]);
    b.tap(3, &[7; 256]);
    b.finish_block();
    assert_eq!(seg.s().ring[0].write, 0, "nobody listens to channel 0");
    assert_eq!(seg.s().ring[3].write, 1);
    assert!(seg.s().ring[3].b[0].lr.iter().all(|&x| x == 7));
    assert!(seg.s().ring[3].b[0].play_time_us > 0);
}

#[test]
fn untapped_subscribed_channel_gets_silence() {
    let seg = Seg::new();
    seg.s().subscribed = 1 << CH_MASTER | 1 << 5;
    let mut b = LinkBridge::from_raw(seg.0);
    b.begin_block(12000);
    b.tap(CH_MASTER, &[9; 256]);
    b.finish_block();
    assert_eq!(seg.s().ring[5].write, 1, "a muted/asleep track still streams");
    assert!(seg.s().ring[5].b[0].lr.iter().all(|&x| x == 0));
    assert_eq!(seg.s().ring[CH_MASTER].write, 1, "tapped once, not twice");
}

#[test]
fn tap_full_ring_drops_and_counts() {
    let seg = Seg::new();
    seg.s().subscribed = 1;
    let mut b = LinkBridge::from_raw(seg.0);
    for _ in 0..LINK_RING + 3 {
        b.begin_block(12000);
        b.tap(0, &[1; 256]);
    }
    assert_eq!(seg.s().ring[0].write, LINK_RING as u32);
    assert_eq!(seg.s().ring[0].drops, 3);
}

#[test]
fn tap_gains_equals_mix_contribution() {
    let seg = Seg::new();
    seg.s().subscribed = 1;
    let mut b = LinkBridge::from_raw(seg.0);
    b.begin_block(12000);
    let src: Vec<i16> = (0..256).map(|i| (i * 97 % 20000) as i16 - 10000).collect();
    b.tap_gains(0, &src, 0.7, 0.3);
    let mut mixed = vec![0i16; 256];
    crate::mixer::mix_into_gains(&mut mixed, &src, 0.7, 0.3);
    assert_eq!(&seg.s().ring[0].b[0].lr[..], &mixed[..]);
}

#[test]
fn requests_written_seq_last() {
    let seg = Seg::new();
    let mut b = LinkBridge::from_raw(seg.0);
    b.write_requests(&LinkRequests { tempo_seq: 4, tempo_bpm_x100: 14000, play_seq: 2, playing: true, play_at_us: 77 });
    let s = seg.s();
    assert_eq!((s.tempo_req_seq, s.tempo_req_bpm_x100, s.play_req_seq, s.play_req_playing, s.play_req_at_us), (4, 14000, 2, 1, 77));
}

#[test]
fn status_carries_link_keys() {
    let seg = Seg::new();
    seg.s().peers = 1;
    seg.s().subscribed = 0x80001;
    let mut b = LinkBridge::from_raw(seg.0);
    b.begin_block(12000);
    assert_eq!(b.status(), " lk=1 lkp=1 lks=80001");
}

/* The audio-thread budget for Link: all 20 channels subscribed, one block.
 * Release build only (`cargo test --release -p movy-dsp link_tap_cost --
 * --ignored`); a debug build measures the debug build. Host numbers: the
 * device is ~3x slower, against a 2902 us frame. */
#[test]
#[ignore]
fn link_tap_cost() {
    let seg = Seg::new();
    seg.s().subscribed = (1 << LINK_CHANNELS) - 1;
    let mut b = LinkBridge::from_raw(seg.0);
    let src = [123i16; 256];
    let n = 20_000;
    let t = std::time::Instant::now();
    for _ in 0..n {
        b.begin_block(12000);
        for ch in 0..16 {
            b.tap_gains(ch, &src, 0.8, 0.6);
        }
        for ch in 16..LINK_CHANNELS {
            b.tap(ch, &src);
        }
        b.finish_block();
        for r in seg.s().ring.iter_mut() {
            r.read = r.write; // a consumer that keeps up
        }
    }
    let us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
    println!("link tap: {us:.2} us/block, 20 channels");
    assert!(us < 5.0, "{us:.2} us/block");
}

#[test]
fn helper_stall_reads_as_alone() {
    // movy-link died mid-session: its last snapshot said one peer. Following a
    // frozen timeline would fight every tempo change, so a helper whose own
    // counter stops for ~1 s is read as no session at all.
    let seg = Seg::new();
    seg.s().peers = 1;
    seg.s().tempo = 120.0;
    seg.s().snap_seq = 2;
    let mut b = LinkBridge::from_raw(seg.0);
    for i in 0..10 {
        seg.s().link_alive = i;
        assert_eq!(b.begin_block(12000).0.peers, 1, "alive");
    }
    for _ in 0..STALL_BLOCKS {
        b.begin_block(12000);
    }
    let (snap, _, mask) = b.begin_block(12000);
    assert_eq!(snap.peers, 0, "stalled helper: alone");
    assert_eq!(mask, 0, "and nothing is tapped for it");
    seg.s().link_alive = 99;
    assert_eq!(b.begin_block(12000).0.peers, 1, "back as soon as it counts again");
}
