//! The `host_api_v1_t` movy synthesises for every chain it hosts, and through
//! the chain host's `memcpy` for every module inside those chains.
//!
//! It starts as a copy of the vtable movy itself was handed, so `log`,
//! `mapped_memory` and the audio offsets are the host's. Two families are
//! replaced:
//!
//! - **The single-producer MIDI sends** get wrappers that park a call made from
//!   inside a render (`midi_out`).
//! - **The clock** (`get_bpm`, `get_beat_position`, `get_clock_status`) answers
//!   from movy's own sequencer, published once per block by `publish_clock`.
//!   Schwung's answers came from its transport service, which only knew movy's
//!   tempo by listening to the 0xF8 movy sends to schwung's slots — and which a
//!   standalone host does not have at all. Movy's chains follow movy's
//!   transport, in either host.
//!
//! One struct per process, built once and leaked, because the chain host keeps
//! the pointer in its own `g_host` and dereferences it on the audio thread for
//! as long as any chain exists.

use crate::ffi::host_api_v1_t;
use crate::host;
use crate::midi_out::QUEUE;
use core::ffi::c_int;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;

/// `plugin_api_v1.h` MOVE_CLOCK_STATUS_*.
const CLOCK_STATUS_STOPPED: c_int = 1;
const CLOCK_STATUS_RUNNING: c_int = 2;

/// An `AtomicPtr` and not a `OnceLock` only because the struct holds raw
/// pointers and so is not `Sync`; `get` is reached from a param set, never from
/// render, so the init race is theoretical.
static MOVY_HOST: AtomicPtr<host_api_v1_t> = AtomicPtr::new(core::ptr::null_mut());

/* The clock as of the last block. Atomics because the readers are chain
 * renders on the pool's lanes, while the writer is the audio thread before the
 * fan-out — the join orders them within a block, and Relaxed is enough for a
 * value that is only ever a whole block old. */
static BPM_BITS: AtomicU32 = AtomicU32::new(0x42F0_0000); // 120.0f32
static BEAT_BITS: AtomicU64 = AtomicU64::new(0xBFF0_0000_0000_0000); // -1.0f64
static RUNNING: AtomicBool = AtomicBool::new(false);

/// Publish the sequencer's clock for this block. `beat` is quarter notes since
/// transport start, None while stopped — the shape schwung's own
/// `shadow_transport_beat_position` has, which is what the chain host's LFO
/// sync was written against (`< 0` = free-run at `get_bpm`).
pub fn publish_clock(bpm: f32, beat: Option<f64>) {
    BPM_BITS.store(bpm.to_bits(), Ordering::Relaxed);
    BEAT_BITS.store(beat.unwrap_or(-1.0).to_bits(), Ordering::Relaxed);
    RUNNING.store(beat.is_some(), Ordering::Relaxed);
}

unsafe extern "C" fn clock_bpm() -> f32 {
    f32::from_bits(BPM_BITS.load(Ordering::Relaxed))
}

unsafe extern "C" fn clock_beat_position() -> f64 {
    f64::from_bits(BEAT_BITS.load(Ordering::Relaxed))
}

/// Never UNAVAILABLE: movy always has a clock, running or not. The chain host
/// overrides this for its sub-plugins with one derived from MIDI ticks; this is
/// what anything reading the host's own pointer sees.
unsafe extern "C" fn clock_status() -> c_int {
    if RUNNING.load(Ordering::Relaxed) { CLOCK_STATUS_RUNNING } else { CLOCK_STATUS_STOPPED }
}

unsafe extern "C" fn shim_send_internal(msg: *const u8, len: c_int) -> c_int {
    shim_send(msg, len, false)
}

unsafe extern "C" fn shim_send_external(msg: *const u8, len: c_int) -> c_int {
    shim_send(msg, len, true)
}

/// Park the call if a chain is rendering on this thread, otherwise forward it
/// untouched. The forward path is what movy's own engine sends take, and it is
/// the same pointer the host installed — one extra branch, no behaviour change.
unsafe fn shim_send(msg: *const u8, len: c_int, external: bool) -> c_int {
    if msg.is_null() || len <= 0 {
        return 0;
    }
    let slice = core::slice::from_raw_parts(msg, len as usize);
    if let Some(n) = QUEUE.park(slice, external) {
        return n;
    }
    // Not inside a render: straight through to the host's own sender, saved
    // before the copy's pointers were overwritten. Calling back through the
    // copy would recurse.
    let Some((int_fn, ext_fn)) = ORIGINALS.get() else { return 0 };
    match if external { *ext_fn } else { *int_fn } {
        Some(f) => f(msg, len),
        None => 0,
    }
}

type SendFn = unsafe extern "C" fn(msg: *const u8, len: c_int) -> c_int;

/// The host's own `(internal, external)` senders, saved before the copy's
/// pointers are overwritten. The drain and the pass-through both go here.
static ORIGINALS: OnceLock<(Option<SendFn>, Option<SendFn>)> = OnceLock::new();

/// Replay one parked message to the host. Audio thread, after the join.
pub fn send_direct(msg: &[u8], external: bool) {
    let Some((int_fn, ext_fn)) = ORIGINALS.get() else { return };
    let f = if external { *ext_fn } else { *int_fn };
    if let Some(f) = f {
        unsafe { f(msg.as_ptr(), msg.len() as c_int) };
    }
}

/// The vtable to hand a chain host: built on first use from the host's.
///
/// A COPY and not a mutation of the host's own struct: under schwung that
/// struct is shared with schwung's four native chain slots and every other
/// module in the process, none of which renders on a movy lane or follows
/// movy's transport.
pub fn get() -> *const host_api_v1_t {
    let raw = host::raw();
    if raw.is_null() {
        return raw;
    }
    let existing = MOVY_HOST.load(Ordering::Acquire);
    if !existing.is_null() {
        return existing;
    }
    let leaked: *mut host_api_v1_t = Box::leak(Box::new(synthesise(raw)));
    MOVY_HOST.store(leaked, Ordering::Release);
    leaked
}

/// The copy with movy's replacements in it. Split from `get` so a test can
/// build one from a fake host without touching the process-wide pointer.
fn synthesise(raw: *const host_api_v1_t) -> host_api_v1_t {
    // Safe: the host hands movy this pointer at plugin init and it outlives the
    // process. The struct is mirrored in full (see `ffi.rs`), which
    // `abi-parity.mjs` asserts, so the copy carries every field the chain host
    // reads — `slot_recv_channel` included.
    let mut copy = unsafe { core::ptr::read(raw) };
    let _ = ORIGINALS.set((copy.midi_send_internal, copy.midi_send_external));
    copy.midi_send_internal = Some(shim_send_internal);
    copy.midi_send_external = Some(shim_send_external);
    copy.get_bpm = Some(clock_bpm);
    copy.get_beat_position = Some(clock_beat_position);
    copy.get_clock_status = Some(clock_status);
    // Written rather than copied, because the read above can be the thing that
    // gets it wrong: on a host older than the reserved tail, `read` takes 64
    // bytes from past the end of THEIR struct. NULL is the only correct value
    // here whatever the host holds — movy provides no callback in the reserved
    // run — so a module guarding `if (host->get_project_bpm)` on a field movy
    // has never heard of gets the NULL its guard was written for.
    copy.reserved = [core::ptr::null_mut(); 8];
    copy
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_host() -> host_api_v1_t {
        unsafe extern "C" fn host_bpm() -> f32 { 99.0 }
        unsafe extern "C" fn host_beat() -> f64 { 7.0 }
        unsafe extern "C" fn host_status() -> c_int { 0 }
        let mut h: host_api_v1_t = unsafe { core::mem::zeroed() };
        h.sample_rate = 44100;
        h.get_bpm = Some(host_bpm);
        h.get_beat_position = Some(host_beat);
        h.get_clock_status = Some(host_status);
        h.reserved = [1 as *mut core::ffi::c_void; 8];
        h
    }

    /* One test, because the clock statics are process-wide and cargo runs
     * tests on parallel threads: two tests publishing would race each other. */
    #[test]
    fn synthesised_vtable_answers_from_movys_clock_not_the_hosts() {
        let host = fake_host();
        let v = synthesise(&host);
        assert_eq!(v.sample_rate, 44100, "plain fields are the host's");
        assert!(v.reserved.iter().all(|p| p.is_null()), "the reserved tail is NULL");

        let (bpm, beat, status) =
            (v.get_bpm.unwrap(), v.get_beat_position.unwrap(), v.get_clock_status.unwrap());

        publish_clock(133.5, None);
        unsafe {
            assert_eq!(bpm(), 133.5, "tempo is movy's even while stopped");
            assert!(beat() < 0.0, "stopped reads as no transport, so LFOs free-run");
            assert_eq!(status(), CLOCK_STATUS_STOPPED);
        }

        publish_clock(90.0, Some(4.25));
        unsafe {
            assert_eq!(bpm(), 90.0);
            assert_eq!(beat(), 4.25);
            assert_eq!(status(), CLOCK_STATUS_RUNNING);
        }
    }
}
