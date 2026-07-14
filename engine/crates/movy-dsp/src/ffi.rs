//! Hand-written bindings for schwung's plugin ABI
//! (`schwung/src/host/plugin_api_v1.h`, v2 section). Layouts must match the
//! C structs field-for-field; all function pointers are `Option` because the
//! host may leave optional capabilities NULL.

#![allow(non_camel_case_types)]
#![allow(dead_code)] // ABI constants documented here even before first use

use core::ffi::{c_char, c_int, c_void};

pub const MOVE_FRAMES_PER_BLOCK: c_int = 128;

/// MIDI source identifiers (subset we care about).
pub const MOVE_MIDI_SOURCE_INTERNAL: c_int = 0;
pub const MOVE_MIDI_SOURCE_EXTERNAL: c_int = 2;

#[repr(C)]
pub struct host_api_v1_t {
    pub api_version: u32,
    pub sample_rate: c_int,
    pub frames_per_block: c_int,
    pub mapped_memory: *mut u8,
    pub audio_out_offset: c_int,
    pub audio_in_offset: c_int,
    pub log: Option<unsafe extern "C" fn(msg: *const c_char)>,
    pub midi_send_internal: Option<unsafe extern "C" fn(msg: *const u8, len: c_int) -> c_int>,
    pub midi_send_external: Option<unsafe extern "C" fn(msg: *const u8, len: c_int) -> c_int>,
    pub get_clock_status: Option<unsafe extern "C" fn() -> c_int>,
    // move_mod_emit_value_fn / move_mod_clear_source_fn — never called by the
    // sequencer; only the pointer slots must exist for layout compatibility.
    pub mod_emit_value: Option<
        unsafe extern "C" fn(
            ctx: *mut c_void,
            source_id: *const c_char,
            target: *const c_char,
            param: *const c_char,
            signal: f32,
            depth: f32,
            offset: f32,
            bipolar: c_int,
            enabled: c_int,
        ) -> c_int,
    >,
    pub mod_clear_source: Option<unsafe extern "C" fn(ctx: *mut c_void, source_id: *const c_char)>,
    pub mod_host_ctx: *mut c_void,
    pub get_bpm: Option<unsafe extern "C" fn() -> f32>,
    // Field order mirrors host_api_v1_t — NEVER reorder or skip. midi_inject_to_move
    // sits immediately after get_bpm; the C struct's trailing slot_recv_channel is
    // intentionally omitted (unused here — a shorter prefix of an over-allocated struct).
    pub midi_inject_to_move: Option<unsafe extern "C" fn(msg: *const u8, len: c_int) -> c_int>,
}

#[repr(C)]
pub struct plugin_api_v2_t {
    pub api_version: u32,
    pub create_instance: Option<
        unsafe extern "C" fn(module_dir: *const c_char, json_defaults: *const c_char) -> *mut c_void,
    >,
    pub destroy_instance: Option<unsafe extern "C" fn(instance: *mut c_void)>,
    pub on_midi:
        Option<unsafe extern "C" fn(instance: *mut c_void, msg: *const u8, len: c_int, source: c_int)>,
    pub set_param:
        Option<unsafe extern "C" fn(instance: *mut c_void, key: *const c_char, val: *const c_char)>,
    pub get_param: Option<
        unsafe extern "C" fn(
            instance: *mut c_void,
            key: *const c_char,
            buf: *mut c_char,
            buf_len: c_int,
        ) -> c_int,
    >,
    pub get_error:
        Option<unsafe extern "C" fn(instance: *mut c_void, buf: *mut c_char, buf_len: c_int) -> c_int>,
    pub render_block:
        Option<unsafe extern "C" fn(instance: *mut c_void, out_interleaved_lr: *mut i16, frames: c_int)>,
}
