//! Safe-ish wrapper around the host vtable. The host pointer is stored once
//! at `move_plugin_init_v2` and is valid for the plugin's lifetime.

use crate::ffi::host_api_v1_t;
use std::ffi::CString;
use std::sync::atomic::{AtomicPtr, Ordering};

static HOST: AtomicPtr<host_api_v1_t> = AtomicPtr::new(core::ptr::null_mut());

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
