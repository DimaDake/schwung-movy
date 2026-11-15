//! The movy-link segment, as `link/movy_link_shm.h` lays it out. The header
//! says which process owns which field; this file only mirrors it.

pub const LINK_SHM_NAME: &[u8] = b"/movy-link\0";
pub const LINK_MAGIC: u32 = 0x4B4E_4C4D;
pub const LINK_VERSION: u32 = 1;
pub const LINK_CHANNELS: usize = 20;
pub const CH_SEND0: usize = 16;
pub const CH_MASTER: usize = 19;
pub const LINK_FRAMES: usize = 128;
pub const LINK_RING: usize = 32;

#[repr(C)]
pub struct LinkBlock {
    pub play_time_us: u64,
    pub frame: u64,
    pub lr: [i16; LINK_FRAMES * 2],
}

#[repr(C)]
pub struct LinkRing {
    pub write: u32,
    pub read: u32,
    pub drops: u32,
    pub pad: u32,
    pub b: [LinkBlock; LINK_RING],
}

#[repr(C)]
pub struct LinkShm {
    pub magic: u32,
    pub version: u32,
    pub enabled: u32,
    pub host_pid: u32,
    pub heartbeat: u64,
    pub movy_bpm_x100: u32,
    pub tempo_req_seq: u32,
    pub tempo_req_bpm_x100: u32,
    pub play_req_seq: u32,
    pub play_req_playing: u32,
    pub pad0: u32,
    pub play_req_at_us: u64,
    pub snap_seq: u32,
    pub peers: u32,
    pub tempo: f64,
    pub beat_anchor: f64,
    pub time_anchor_us: u64,
    pub is_playing: u32,
    pub tempo_ack_seq: u32,
    pub play_change_us: u64,
    pub play_ack_seq: u32,
    pub subscribed: u32,
    pub link_alive: u32,
    pub sent: u32,
    pub ring: [LinkRing; LINK_CHANNELS],
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{offset_of, size_of};

    /* The same literals as host/tests/test_link_shm_abi.c: the C header is
     * the contract and both suites pin it. */
    #[test]
    fn layout_matches_c() {
        assert_eq!(size_of::<LinkBlock>(), 528);
        assert_eq!(size_of::<LinkRing>(), 16912);
        assert_eq!(size_of::<LinkShm>(), 338360);
        assert_eq!(offset_of!(LinkShm, heartbeat), 16);
        assert_eq!(offset_of!(LinkShm, movy_bpm_x100), 24);
        assert_eq!(offset_of!(LinkShm, play_req_at_us), 48);
        assert_eq!(offset_of!(LinkShm, snap_seq), 56);
        assert_eq!(offset_of!(LinkShm, tempo), 64);
        assert_eq!(offset_of!(LinkShm, time_anchor_us), 80);
        assert_eq!(offset_of!(LinkShm, play_change_us), 96);
        assert_eq!(offset_of!(LinkShm, subscribed), 108);
        assert_eq!(offset_of!(LinkShm, ring), 120);
    }
}
