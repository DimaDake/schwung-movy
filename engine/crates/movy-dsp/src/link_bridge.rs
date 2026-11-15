//! The engine's end of the movy-link segment (link_shm.rs): once per block it
//! reads the session snapshot, publishes its heartbeat, tempo and requests,
//! and copies the blocks Live subscribed to into their rings.
//!
//! Audio thread only, and it stays cheap: one `clock_gettime` (vDSO), a
//! seqlock copy, and a bit test per channel. A missing, foreign or old
//! segment leaves the bridge inert, so movy without movy-link is unchanged.

use crate::link_shm::*;
use core::sync::atomic::{fence, AtomicU32, AtomicU64, Ordering::*};
use seq_core::link_follow::{LinkRequests, LinkSnapshot};

/// Time from the start of `render_block` to the block's first sample leaving
/// Move: one frame in flight plus the codec. CALIBRATE on the device with Live
/// (plans/2026-11-15-ableton-link-plan.md Task 8).
pub const OUTPUT_LATENCY_US: u64 = 2 * 2902;

/// Blocks (~1 s) without movy-link's own counter moving before its last
/// snapshot is no longer believed: following a dead helper's frozen timeline
/// would fight every tempo change made on movy.
pub const STALL_BLOCKS: u32 = 345;

pub struct LinkBridge {
    shm: *mut LinkShm,
    last: LinkSnapshot,
    mask: u32,
    tapped: u32,
    out_us: u64,
    blocks: u64,
    alive_seen: u32,
    stalled_for: u32,
}

// The segment outlives the instance and only the audio thread touches it.
unsafe impl Send for LinkBridge {}

fn a32<'a>(p: *mut u32) -> &'a AtomicU32 {
    unsafe { AtomicU32::from_ptr(p) }
}
fn a64<'a>(p: *mut u64) -> &'a AtomicU64 {
    unsafe { AtomicU64::from_ptr(p) }
}

impl LinkBridge {
    pub fn inert() -> Self {
        LinkBridge { shm: core::ptr::null_mut(), last: LinkSnapshot::default(), mask: 0, tapped: 0, out_us: 0, blocks: 0,
                     alive_seen: 0, stalled_for: 0 }
    }

    /// The segment movy-host created, or inert.
    pub fn open() -> Self {
        #[cfg(target_os = "linux")]
        unsafe {
            let fd = shm_open(LINK_SHM_NAME.as_ptr() as *const _, 2 /* O_RDWR */, 0);
            if fd >= 0 {
                let len = core::mem::size_of::<LinkShm>();
                let p = mmap(core::ptr::null_mut(), len, 3 /* RW */, 1 /* SHARED */, fd, 0);
                close(fd);
                if p as isize != -1 {
                    return Self::from_raw(p as *mut LinkShm);
                }
            }
        }
        Self::inert()
    }

    pub fn from_raw(p: *mut LinkShm) -> Self {
        let ok = !p.is_null()
            && unsafe {
                a32(&raw mut (*p).magic).load(Acquire) == LINK_MAGIC && (*p).version == LINK_VERSION
            };
        let mut b = Self::inert();
        if ok {
            b.shm = p;
        }
        b
    }

    /// Start of a block: (snapshot, when this block plays, subscribed mask).
    pub fn begin_block(&mut self, bpm_x100: u32) -> (LinkSnapshot, u64, u32) {
        self.tapped = 0;
        self.out_us = now_raw_us() + OUTPUT_LATENCY_US;
        let p = self.shm;
        if p.is_null() {
            return (LinkSnapshot::default(), self.out_us, 0);
        }
        self.blocks += 1;
        unsafe {
            a64(&raw mut (*p).heartbeat).store(self.blocks, Release);
            a32(&raw mut (*p).movy_bpm_x100).store(bpm_x100, Relaxed);
            for _ in 0..3 {
                let s1 = a32(&raw mut (*p).snap_seq).load(Acquire);
                if s1 & 1 != 0 {
                    continue;
                }
                let snap = LinkSnapshot {
                    enabled: false,
                    peers: core::ptr::read_volatile(&raw const (*p).peers),
                    tempo: core::ptr::read_volatile(&raw const (*p).tempo),
                    beat_anchor: core::ptr::read_volatile(&raw const (*p).beat_anchor),
                    time_anchor_us: core::ptr::read_volatile(&raw const (*p).time_anchor_us),
                    is_playing: core::ptr::read_volatile(&raw const (*p).is_playing) != 0,
                    play_change_us: core::ptr::read_volatile(&raw const (*p).play_change_us),
                    tempo_ack_seq: core::ptr::read_volatile(&raw const (*p).tempo_ack_seq),
                    play_ack_seq: core::ptr::read_volatile(&raw const (*p).play_ack_seq),
                };
                fence(Acquire);
                if a32(&raw mut (*p).snap_seq).load(Relaxed) == s1 {
                    self.last = snap;
                    break;
                }
            }
            self.last.enabled = a32(&raw mut (*p).enabled).load(Acquire) != 0;
            let alive = a32(&raw mut (*p).link_alive).load(Relaxed);
            if alive != self.alive_seen {
                self.alive_seen = alive;
                self.stalled_for = 0;
            } else {
                self.stalled_for = self.stalled_for.saturating_add(1);
            }
            self.mask = if self.last.enabled { a32(&raw mut (*p).subscribed).load(Relaxed) } else { 0 };
        }
        if self.stalled_for >= STALL_BLOCKS {
            // Re-read from the segment next block, so a helper that counts
            // again is believed at once; the status says "alone" meanwhile.
            self.mask = 0;
            self.last.peers = 0;
        }
        (self.last, self.out_us, self.mask)
    }

    pub fn write_requests(&mut self, r: &LinkRequests) {
        let p = self.shm;
        if p.is_null() {
            return;
        }
        unsafe {
            // Values first, seq last: movy-link acts on a new seq.
            a32(&raw mut (*p).tempo_req_bpm_x100).store(r.tempo_bpm_x100, Relaxed);
            a32(&raw mut (*p).tempo_req_seq).store(r.tempo_seq, Release);
            a32(&raw mut (*p).play_req_playing).store(r.playing as u32, Relaxed);
            a64(&raw mut (*p).play_req_at_us).store(r.play_at_us, Relaxed);
            a32(&raw mut (*p).play_req_seq).store(r.play_seq, Release);
        }
    }

    pub fn wants(&self, ch: usize) -> bool {
        ch < LINK_CHANNELS && self.mask & (1 << ch) != 0
    }

    /// A block as-is (a send's return, the master).
    pub fn tap(&mut self, ch: usize, lr: &[i16]) {
        self.tap_with(ch, |dst| {
            let n = lr.len().min(dst.len());
            dst[..n].copy_from_slice(&lr[..n]);
        });
    }

    /// A track's block at its fader and pan: exactly what `mix_into` adds.
    pub fn tap_gains(&mut self, ch: usize, src: &[i16], gl: f32, gr: f32) {
        self.tap_with(ch, |dst| {
            let n = src.len().min(dst.len()) / 2 * 2;
            for i in (0..n).step_by(2) {
                dst[i] = crate::mixer::saturate((src[i] as f32 * gl) as i32);
                dst[i + 1] = crate::mixer::saturate((src[i + 1] as f32 * gr) as i32);
            }
        });
    }

    /// End of a block: a subscribed channel nothing tapped (a silent, muted or
    /// sleeping track) gets silence, so Live sees a quiet track, not a gap.
    pub fn finish_block(&mut self) {
        let missing = self.mask & !self.tapped;
        for ch in 0..LINK_CHANNELS {
            if missing & (1 << ch) != 0 {
                self.tap_with(ch, |_| {});
            }
        }
    }

    fn tap_with(&mut self, ch: usize, fill: impl FnOnce(&mut [i16])) {
        if !self.wants(ch) || self.tapped & (1 << ch) != 0 {
            return;
        }
        self.tapped |= 1 << ch;
        unsafe {
            let ring = &raw mut (*self.shm).ring[ch];
            let w = a32(&raw mut (*ring).write).load(Relaxed);
            let r = a32(&raw mut (*ring).read).load(Acquire);
            if w.wrapping_sub(r) >= LINK_RING as u32 {
                a32(&raw mut (*ring).drops).fetch_add(1, Relaxed);
                return;
            }
            let b = &mut (*ring).b[w as usize % LINK_RING];
            b.play_time_us = self.out_us;
            b.frame = self.blocks;
            b.lr.fill(0);
            fill(&mut b.lr);
            a32(&raw mut (*ring).write).store(w.wrapping_add(1), Release);
        }
    }

    /// ` lk=<on> lkp=<peers> lks=<subscribed, hex>` for the UI's status poll.
    pub fn status(&self) -> String {
        format!(" lk={} lkp={} lks={:x}", self.last.enabled as u8, self.last.peers, self.mask)
    }
}

#[repr(C)]
struct Timespec {
    sec: i64,
    nsec: i64,
}

extern "C" {
    fn clock_gettime(clk: i32, ts: *mut Timespec) -> i32;
}
#[cfg(target_os = "linux")]
extern "C" {
    fn shm_open(name: *const core::ffi::c_char, oflag: i32, mode: u32) -> i32;
    fn mmap(addr: *mut core::ffi::c_void, len: usize, prot: i32, flags: i32, fd: i32, off: i64) -> *mut core::ffi::c_void;
    fn close(fd: i32) -> i32;
}

/// CLOCK_MONOTONIC_RAW: the Link SDK's clock on Linux (4 on Linux and macOS).
pub fn now_raw_us() -> u64 {
    let mut ts = Timespec { sec: 0, nsec: 0 };
    unsafe { clock_gettime(4, &mut ts) };
    ts.sec as u64 * 1_000_000 + ts.nsec as u64 / 1000
}

#[cfg(test)]
#[path = "link_bridge_tests.rs"]
mod tests;
