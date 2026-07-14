//! movy-dsp: the cdylib boundary. Exports `move_plugin_init_v2` and adapts
//! schwung's C plugin ABI onto seq-core. All sequencing logic lives in
//! seq-core; this layer only parses params, drains engine events into host
//! MIDI sends, and renders the metronome click.

mod click;
mod ffi;
mod host;

use click::Click;
use core::ffi::{c_char, c_int, c_void};
use ffi::*;
use seq_core::command::apply_batch;
use seq_core::engine::{Engine, OutEvent};
use std::ffi::{CStr, CString};

const DEFAULT_BPM_X100: u32 = 12000;
const ENGINE_VERSION: &str = "0.24.0";

struct Instance {
    engine: Engine,
    out: Vec<OutEvent>,
    click: Click,
    blocks: u64,
}

impl Instance {
    fn new() -> Self {
        let rate = host::sample_rate();
        Instance {
            engine: Engine::new(rate, DEFAULT_BPM_X100),
            out: Vec::with_capacity(256),
            click: Click::new(rate),
            blocks: 0,
        }
    }

    fn set_param(&mut self, key: &str, val: &str) {
        match key {
            "cmd" => {
                apply_batch(&mut self.engine, val, &mut self.out);
            }
            // schwung sends these automatically at tool launch
            "project_bpm" => {
                if let Ok(bpm) = val.trim().parse::<f32>() {
                    if bpm > 0.0 {
                        self.engine.clock.set_bpm_x100((bpm * 100.0) as u32);
                    }
                }
            }
            "file_path" => {}
            // Load persisted state (UI sends the autosave file's contents).
            "state" => {
                if seq_core::persist::load(&mut self.engine, val) {
                    self.engine.dirty = false;
                }
            }
            _ => {}
        }
    }

    fn get_param(&mut self, key: &str) -> Option<String> {
        match key {
            "status" => Some(self.engine.status()),
            "alabels" => Some(self.engine.auto_labels()),
            "ping" => Some(format!("pong {ENGINE_VERSION}")),
            // Serialize for autosave; reading it clears the dirty flag (the UI
            // is about to persist exactly this snapshot).
            "state" => {
                let s = seq_core::persist::serialize(&self.engine);
                self.engine.dirty = false;
                Some(s)
            }
            "diag" => Some(format!("blocks={} out_cap={}", self.blocks, self.out.capacity())),
            _ => None,
        }
    }

    /// Turn engine events into host MIDI sends + metronome triggers. Indexes
    /// `out` (events are Copy) so `click` can be borrowed in the same pass,
    /// then clears it — preserving the buffer's capacity across blocks.
    fn drain_out(&mut self) {
        for i in 0..self.out.len() {
            match self.out[i] {
                OutEvent::NoteOn { track, pitch, vel } => {
                    host::midi_send_internal(0x90 | track, pitch, vel);
                }
                OutEvent::NoteOff { track, pitch } => {
                    host::midi_send_internal(0x80 | track, pitch, 0);
                }
                OutEvent::Click { accent } => {
                    self.click.trigger(accent);
                }
                OutEvent::Cc { track, lane, val } => {
                    host::midi_send_internal(0xB0 | track, 102 + lane, val);
                }
                OutEvent::Start => {
                    host::midi_send_internal(0xFA, 0, 0);
                }
                OutEvent::Stop => {
                    host::midi_send_internal(0xFC, 0, 0);
                }
                OutEvent::Clock => {
                    host::midi_send_internal(0xF8, 0, 0);
                }
            }
        }
        self.out.clear();
    }

    fn on_external_realtime(&mut self, status: u8) {
        // Events queue into self.out and drain on the next render_block.
        self.engine.on_external_realtime(status, &mut self.out);
    }

    fn render(&mut self, out_audio: &mut [i16]) {
        self.blocks += 1;
        self.engine
            .advance_block((out_audio.len() / 2) as u32, &mut self.out);
        self.drain_out();
        self.click.render(out_audio);
    }
}

// ---------------------------------------------------------------------------
// C ABI glue
// ---------------------------------------------------------------------------

/// Panics must never unwind across the C boundary (UB) or abort the host
/// process — the engine runs inside MoveOriginal, and taking it down kills
/// the device's entire audio stack. Every entry point funnels through here.
fn guard<T>(default: T, f: impl FnOnce() -> T) -> T {
    use std::sync::atomic::{AtomicBool, Ordering};
    static PANICKED: AtomicBool = AtomicBool::new(false);
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(v) => v,
        Err(_) => {
            if !PANICKED.swap(true, Ordering::SeqCst) {
                host::log("movy-dsp: PANIC caught at FFI boundary (engine degraded)");
            }
            default
        }
    }
}

unsafe fn inst<'a>(p: *mut c_void) -> Option<&'a mut Instance> {
    (p as *mut Instance).as_mut()
}

unsafe fn cstr<'a>(p: *const c_char) -> &'a str {
    if p.is_null() {
        ""
    } else {
        CStr::from_ptr(p).to_str().unwrap_or("")
    }
}

unsafe extern "C" fn create_instance(
    module_dir: *const c_char,
    _json_defaults: *const c_char,
) -> *mut c_void {
    guard(core::ptr::null_mut(), || {
        let dir = cstr(module_dir).to_string();
        let instance = Box::new(Instance::new());
        host::log(&format!(
            "movy-dsp v{ENGINE_VERSION}: create_instance dir={dir} rate={}",
            host::sample_rate()
        ));
        Box::into_raw(instance) as *mut c_void
    })
}

unsafe extern "C" fn destroy_instance(instance: *mut c_void) {
    guard((), || {
        if !instance.is_null() {
            drop(Box::from_raw(instance as *mut Instance));
            host::log("movy-dsp: destroy_instance");
        }
    });
}

unsafe extern "C" fn on_midi(instance: *mut c_void, msg: *const u8, len: c_int, _source: c_int) {
    guard((), || {
        // Surface input arrives via the cmd protocol; the only raw MIDI the
        // shim delivers here is Move's cable-0 system realtime (1 byte).
        if msg.is_null() || len < 1 {
            return;
        }
        let status = unsafe { *msg };
        if status < 0xF8 {
            return;
        }
        if let Some(i) = inst(instance) {
            i.on_external_realtime(status);
        }
    });
}

unsafe extern "C" fn set_param(instance: *mut c_void, key: *const c_char, val: *const c_char) {
    guard((), || {
        if let Some(i) = inst(instance) {
            i.set_param(cstr(key), cstr(val));
        }
    });
}

unsafe extern "C" fn get_param(
    instance: *mut c_void,
    key: *const c_char,
    buf: *mut c_char,
    buf_len: c_int,
) -> c_int {
    guard(-1, || {
        let Some(i) = inst(instance) else { return -1 };
        let Some(value) = i.get_param(cstr(key)) else {
            return -1;
        };
        let Ok(c) = CString::new(value) else { return -1 };
        let bytes = c.as_bytes_with_nul();
        if buf.is_null() || (buf_len as usize) < bytes.len() {
            return -1;
        }
        unsafe {
            core::ptr::copy_nonoverlapping(bytes.as_ptr() as *const c_char, buf, bytes.len());
        }
        (bytes.len() - 1) as c_int
    })
}

unsafe extern "C" fn get_error(_instance: *mut c_void, _buf: *mut c_char, _buf_len: c_int) -> c_int {
    0
}

unsafe extern "C" fn render_block(instance: *mut c_void, out: *mut i16, frames: c_int) {
    guard((), || {
        if let Some(i) = inst(instance) {
            if !out.is_null() && frames > 0 {
                let slice = unsafe { core::slice::from_raw_parts_mut(out, frames as usize * 2) };
                i.render(slice);
            }
        }
    });
}

static PLUGIN_API: plugin_api_v2_t = plugin_api_v2_t {
    api_version: 2,
    create_instance: Some(create_instance),
    destroy_instance: Some(destroy_instance),
    on_midi: Some(on_midi),
    set_param: Some(set_param),
    get_param: Some(get_param),
    get_error: Some(get_error),
    render_block: Some(render_block),
};

/// Plugin entry point — schwung dlopens dsp.so and calls this once.
#[no_mangle]
pub unsafe extern "C" fn move_plugin_init_v2(
    host_api: *const host_api_v1_t,
) -> *const plugin_api_v2_t {
    host::set_host(host_api);
    host::log(&format!("movy-dsp v{ENGINE_VERSION}: init"));
    &PLUGIN_API
}
