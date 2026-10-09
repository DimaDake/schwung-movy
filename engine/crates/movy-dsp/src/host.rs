//! Safe-ish wrapper around the host vtable. The host pointer is stored once
//! at `move_plugin_init_v2` and is valid for the plugin's lifetime.

use crate::ffi::host_api_v1_t;
use core::ffi::c_int;
use std::ffi::CString;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

static HOST: AtomicPtr<host_api_v1_t> = AtomicPtr::new(core::ptr::null_mut());

/// `hostmode=standalone`: no Move and no schwung slots beside movy, so the two
/// sends that only ever addressed them are skipped rather than handed to a host
/// that would have to fake a destination. Told by the UI, which knows from
/// `platform.caps`; a process static, so an instance re-create keeps it.
static STANDALONE: AtomicBool = AtomicBool::new(false);

pub fn set_standalone(on: bool) {
    STANDALONE.store(on, Ordering::Relaxed);
}

pub fn set_host(host: *const host_api_v1_t) {
    HOST.store(host as *mut host_api_v1_t, Ordering::SeqCst);
}

/// The raw host pointer: what `host_vtable` copies to build the vtable movy's
/// chains are handed.
pub fn raw() -> *const host_api_v1_t {
    HOST.load(Ordering::Relaxed) as *const host_api_v1_t
}

fn host() -> Option<&'static host_api_v1_t> {
    let p = HOST.load(Ordering::Relaxed);
    if p.is_null() {
        None
    } else {
        Some(unsafe { &*p })
    }
}

pub fn sample_rate() -> u32 {
    host().map(|h| h.sample_rate as u32).unwrap_or(44100)
}

/// Log a line to the schwung shadow log. Not for the render hot path.
pub fn log(msg: &str) {
    if let Some(h) = host() {
        if let Some(f) = h.log {
            if let Ok(c) = CString::new(msg) {
                unsafe { f(c.as_ptr()) };
            }
        }
    }
}

/// Send a 3-byte MIDI message to the schwung chain slots (dispatched by the
/// host to the slot whose receive channel matches `status & 0x0F`).
/// Packet format: 4-byte USB-MIDI [cable|CIN, status, d1, d2], cable 0.
pub fn midi_send_internal(status: u8, d1: u8, d2: u8) -> bool {
    if STANDALONE.load(Ordering::Relaxed) {
        return false;
    }
    if let Some(h) = host() {
        if let Some(f) = h.midi_send_internal {
            let pkt = [(status >> 4) & 0x0F, status, d1, d2];
            return unsafe { f(pkt.as_ptr(), pkt.len() as c_int) } > 0;
        }
    }
    false
}

/// Inject a USB-MIDI packet into Move's MIDI_IN as if it were native hardware
/// input (the always-on transport link's MovePlay toggle — design §7 Phase 4).
/// `cin` is passed explicitly (davebox packet shape `[0x0B, 0xB0, 85, val]`);
/// the host's drain forces cable 0. Absent on non-shadow hosts → false.
pub fn midi_inject_to_move(cin: u8, status: u8, d1: u8, d2: u8) -> bool {
    if STANDALONE.load(Ordering::Relaxed) {
        return false;
    }
    if let Some(h) = host() {
        if let Some(f) = h.midi_inject_to_move {
            let pkt = [cin, status, d1, d2];
            return unsafe { f(pkt.as_ptr(), pkt.len() as c_int) } > 0;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::ffi::c_void;
    use std::sync::atomic::AtomicU32;

    /* Counts only a sentinel message, because the fake host is process-wide
     * and other tests' engines send real notes through it while this runs. */
    static SENTINELS: AtomicU32 = AtomicU32::new(0);
    const SENTINEL: u8 = 0xF4; // undefined system common: nothing else sends it

    unsafe extern "C" fn count(msg: *const u8, len: c_int) -> c_int {
        if len >= 2 && *msg.add(1) == SENTINEL {
            SENTINELS.fetch_add(1, Ordering::SeqCst);
        }
        len
    }

    #[test]
    fn standalone_skips_the_sends_that_only_reach_move_and_its_slots() {
        let mut h: host_api_v1_t = unsafe { core::mem::zeroed() };
        // What no-host reads as, so the engines other tests build meanwhile
        // see the same rate they would without this host installed.
        h.sample_rate = 44100;
        h.frames_per_block = 128;
        h.midi_send_internal = Some(count);
        h.midi_inject_to_move = Some(count);
        h.reserved = [core::ptr::null_mut::<c_void>(); 8];
        set_host(Box::leak(Box::new(h)));

        assert!(midi_send_internal(SENTINEL, 1, 2));
        assert!(midi_inject_to_move(0x0F, SENTINEL, 1, 2));
        assert_eq!(SENTINELS.load(Ordering::SeqCst), 2, "overtake sends both");

        set_standalone(true);
        assert!(!midi_send_internal(SENTINEL, 1, 2));
        assert!(!midi_inject_to_move(0x0F, SENTINEL, 1, 2));
        set_standalone(false);
        assert_eq!(SENTINELS.load(Ordering::SeqCst), 2, "standalone sends neither");
    }
}
