//! Safe-ish wrapper around the host vtable. The host pointer is stored once
//! at `move_plugin_init_v2` and is valid for the plugin's lifetime.

use crate::ffi::host_api_v1_t;
use core::ffi::c_int;
use std::ffi::CString;
use std::sync::atomic::{AtomicPtr, Ordering};

static HOST: AtomicPtr<host_api_v1_t> = AtomicPtr::new(core::ptr::null_mut());

pub fn set_host(host: *const host_api_v1_t) {
    HOST.store(host as *mut host_api_v1_t, Ordering::SeqCst);
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
    if let Some(h) = host() {
        if let Some(f) = h.midi_send_internal {
            let pkt = [(status >> 4) & 0x0F, status, d1, d2];
            return unsafe { f(pkt.as_ptr(), pkt.len() as c_int) } > 0;
        }
    }
    false
}
