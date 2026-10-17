//! `move_info_t` (schwung `src/host/move_info.h`), answered from movy's own
//! transport.
//!
//! A module asks for Move's set-wide settings with `move_info_read()`, which
//! `dlsym`s `schwung_move_info` and, failing that, maps `/schwung-move-info`.
//! Under movy-host neither was movy's: no process exported the symbol, and the
//! segment is tmpfs that outlives the schwung session which wrote it — so a
//! module read MOVE's last tempo and transport, frozen. breakbeat prefers this
//! tempo to `get_bpm`, so it played at a tempo movy was not running.
//!
//! movy-host exports `schwung_move_info` as a trampoline to `movy_move_info`
//! here (`host/vtable.c`), so the first branch of the reader finds movy's.
//! What movy does not own is reported UNKNOWN, as the header defines it: root
//! and scale are the UI's keyboard state, never sent to the engine, and the
//! four Move tracks do not exist.

use crate::host_vtable;
use core::ffi::{c_int, c_void};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

const MOVE_INFO_VERSION: u32 = 1;
const TRACKS: usize = 4;

#[repr(C)]
#[derive(Clone, Copy)]
struct MoveInfoTrack {
    name: [u8; 32],
    color_id: i16,
    kind: i8,
    muted: u8,
    soloed: u8,
    selected: u8,
    _pad: [u8; 2],
    volume_db: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct MoveInfo {
    size: u32,
    version: u32,
    changes: u32,
    valid: u8,
    playing: u8,
    metronome_on: u8,
    midi_clock_sync: u8,
    input_monitoring: u8,
    root_note: i8,
    selected_track: i8,
    global_quant: i8,
    ts_upper: u8,
    ts_lower: u8,
    _pad: [u8; 2],
    tempo: f32,
    groove: f32,
    master_db: f32,
    scale: [u8; 24],
    global_quant_name: [u8; 24],
    song_beats: f64,
    track: [MoveInfoTrack; TRACKS],
}

/* The writer's size is what a reader trusts fields by; it must be the C
 * struct's to the byte (the device's segment is 16 + 272 = 288). */
const _: () = assert!(core::mem::size_of::<MoveInfo>() == 272);

static METRONOME: AtomicBool = AtomicBool::new(false);
static CHANGES: AtomicU32 = AtomicU32::new(0);
/* What `changes` last counted: tempo bits, running, metronome. */
static LAST: AtomicU64 = AtomicU64::new(u64::MAX);

pub fn publish_metronome(on: bool) {
    METRONOME.store(on, Ordering::Relaxed);
}

fn snapshot() -> MoveInfo {
    let (bpm, beat, running) = host_vtable::clock_now();
    let metro = METRONOME.load(Ordering::Relaxed);
    /* `changes` bumps on a change of any reported field but the position,
     * which moves every block and which the header excludes by example. */
    let key = (bpm.to_bits() as u64) | ((running as u64) << 32) | ((metro as u64) << 33);
    if LAST.swap(key, Ordering::Relaxed) != key {
        CHANGES.fetch_add(1, Ordering::Relaxed);
    }
    let unknown_track = MoveInfoTrack {
        name: [0; 32], color_id: -1, kind: -1, muted: 255, soloed: 255, selected: 255,
        _pad: [0; 2], volume_db: -1000.0,
    };
    MoveInfo {
        size: core::mem::size_of::<MoveInfo>() as u32,
        version: MOVE_INFO_VERSION,
        changes: CHANGES.load(Ordering::Relaxed),
        valid: 1,
        playing: running as u8,
        metronome_on: metro as u8,
        midi_clock_sync: 0,
        input_monitoring: 255,
        root_note: -1,
        selected_track: -1,
        global_quant: -1,
        ts_upper: 4,
        ts_lower: 4,
        _pad: [0; 2],
        tempo: bpm,
        groove: -1.0,
        master_db: -1000.0,
        scale: [0; 24],
        global_quant_name: [0; 24],
        song_beats: if running { beat } else { -1.0 },
        track: [unknown_track; TRACKS],
    }
}

/// The shim's export contract: copy `min(cap, size)` bytes, zero the rest.
/// No allocation and no syscall — modules call it from the audio thread.
#[no_mangle]
pub unsafe extern "C" fn movy_move_info(out: *mut c_void, cap: usize) -> c_int {
    if out.is_null() || cap < 8 {
        return 0;
    }
    let info = snapshot();
    let n = cap.min(core::mem::size_of::<MoveInfo>());
    unsafe {
        core::ptr::copy_nonoverlapping(&info as *const MoveInfo as *const u8, out as *mut u8, n);
        if n < cap {
            core::ptr::write_bytes((out as *mut u8).add(n), 0, cap - n);
        }
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_module_reads_movys_transport_not_moves() {
        let _clock = host_vtable::CLOCK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        host_vtable::publish_clock(97.5, Some(8.0));
        publish_metronome(true);
        let mut m: MoveInfo = unsafe { core::mem::zeroed() };
        let ok = unsafe { movy_move_info(&mut m as *mut MoveInfo as *mut c_void, core::mem::size_of::<MoveInfo>()) };
        assert_eq!(ok, 1);
        assert_eq!((m.size, m.version, m.valid), (272, 1, 1));
        assert_eq!((m.tempo, m.playing, m.metronome_on, m.song_beats), (97.5, 1, 1, 8.0));
        assert_eq!((m.root_note, m.scale[0]), (-1, 0), "root/scale are the UI's: unknown");

        /* An older reader asks for less; a newer one gets zeros past ours. */
        let mut big = [0xAAu8; 300];
        unsafe { movy_move_info(big.as_mut_ptr() as *mut c_void, big.len()) };
        assert!(big[272..].iter().all(|&b| b == 0));
    }
}
