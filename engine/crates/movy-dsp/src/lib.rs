//! movy-dsp: the cdylib boundary. Exports `move_plugin_init_v2` and adapts
//! schwung's C plugin ABI onto seq-core. Step-0 spike scope: prove the
//! integration path on device — tick clock in render_block, channel-addressed
//! test notes to the 4 chain slots, audible click, param round-trips.

mod click;
mod ffi;
mod host;

use click::Click;
use core::ffi::{c_char, c_int, c_void};
use ffi::*;
use seq_core::clock::Clock;
use seq_core::{PPQN, TICKS_PER_STEP};
use std::ffi::{CStr, CString};

const DEFAULT_BPM_X100: u32 = 12000;
const ENGINE_VERSION: &str = "0.1.0-spike";

struct PendingNote {
    track: u8,
    pitch: u8,
    vel: u8,
}

struct Gate {
    track: u8,
    pitch: u8,
    ticks_left: u32,
}

struct Instance {
    clock: Clock,
    blocks: u64,
    notes_sent: u32,
    midi_fail: u32,
    max_ticks_per_block: u32,
    pending_notes: Vec<PendingNote>,
    gates: Vec<Gate>,
    click: Click,
    click_beats_left: u32,
}

impl Instance {
    fn new() -> Self {
        let rate = host::sample_rate();
        Instance {
            clock: Clock::new(rate, DEFAULT_BPM_X100),
            blocks: 0,
            notes_sent: 0,
            midi_fail: 0,
            max_ticks_per_block: 0,
            pending_notes: Vec::with_capacity(64),
            gates: Vec::with_capacity(64),
            click: Click::new(rate),
            click_beats_left: 0,
        }
    }

    fn set_param(&mut self, key: &str, val: &str) {
        match key {
            // schwung sends these automatically at tool launch
            "project_bpm" => {
                if let Ok(bpm) = val.trim().parse::<f32>() {
                    if bpm > 0.0 {
                        self.clock.set_bpm_x100((bpm * 100.0) as u32);
                    }
                }
            }
            "file_path" => {}
            "bpm_x100" => {
                if let Ok(v) = val.trim().parse::<u32>() {
                    self.clock.set_bpm_x100(v);
                }
            }
            // spike: "track pitch vel" — emit on next render tick
            "test_note" => {
                let mut it = val.split_whitespace();
                if let (Some(t), Some(p), Some(v)) = (it.next(), it.next(), it.next()) {
                    if let (Ok(track), Ok(pitch), Ok(vel)) =
                        (t.parse::<u8>(), p.parse::<u8>(), v.parse::<u8>())
                    {
                        if track < 4 && pitch < 128 {
                            self.pending_notes.push(PendingNote { track, pitch, vel });
                        }
                    }
                }
            }
            // spike: click on the next N beats
            "test_click" => {
                if let Ok(n) = val.trim().parse::<u32>() {
                    self.click_beats_left = n;
                }
            }
            _ => {
                host::log(&format!("movy-dsp: unknown set_param {key}={val}"));
            }
        }
    }

    fn get_param(&mut self, key: &str) -> Option<String> {
        match key {
            "ping" => Some(format!("pong {ENGINE_VERSION}")),
            "tick_count" => Some(self.clock.tick.to_string()),
            "spike" => Some(format!(
                "blocks={} ticks={} bpm_x100={} notes_sent={} midi_fail={} max_tpb={}",
                self.blocks,
                self.clock.tick,
                self.clock.bpm_x100(),
                self.notes_sent,
                self.midi_fail,
                self.max_ticks_per_block
            )),
            _ => None,
        }
    }

    fn note_on(&mut self, track: u8, pitch: u8, vel: u8) {
        if host::midi_send_internal(0x90 | track, pitch, vel) {
            self.notes_sent += 1;
        } else {
            self.midi_fail += 1;
        }
        self.gates.push(Gate {
            track,
            pitch,
            ticks_left: TICKS_PER_STEP,
        });
    }

    fn service_tick(&mut self) {
        // Note-offs first so same-pitch retriggers stay ordered.
        let mut i = 0;
        while i < self.gates.len() {
            self.gates[i].ticks_left -= 1;
            if self.gates[i].ticks_left == 0 {
                let g = self.gates.swap_remove(i);
                host::midi_send_internal(0x80 | g.track, g.pitch, 0);
            } else {
                i += 1;
            }
        }
        while let Some(n) = self.pending_notes.pop() {
            self.note_on(n.track, n.pitch, n.vel);
        }
        if self.click_beats_left > 0 && self.clock.tick % PPQN as u64 == 0 {
            self.click.trigger(self.clock.tick % (PPQN as u64 * 4) == 0);
            self.click_beats_left -= 1;
        }
    }

    fn render(&mut self, out: &mut [i16]) {
        self.blocks += 1;
        let fired = self.clock.advance((out.len() / 2) as u32);
        self.max_ticks_per_block = self.max_ticks_per_block.max(fired);
        for _ in 0..fired {
            self.service_tick();
        }
        self.click.render(out);
    }
}

// ---------------------------------------------------------------------------
// C ABI glue
// ---------------------------------------------------------------------------

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
    let dir = cstr(module_dir).to_string();
    let instance = Box::new(Instance::new());
    host::log(&format!(
        "movy-dsp v{ENGINE_VERSION}: create_instance dir={dir} rate={}",
        host::sample_rate()
    ));
    Box::into_raw(instance) as *mut c_void
}

unsafe extern "C" fn destroy_instance(instance: *mut c_void) {
    if !instance.is_null() {
        drop(Box::from_raw(instance as *mut Instance));
        host::log("movy-dsp: destroy_instance");
    }
}

unsafe extern "C" fn on_midi(_instance: *mut c_void, _msg: *const u8, _len: c_int, _source: c_int) {
    // Spike: UI owns all input; nothing routed to the engine yet.
}

unsafe extern "C" fn set_param(instance: *mut c_void, key: *const c_char, val: *const c_char) {
    if let Some(i) = inst(instance) {
        i.set_param(cstr(key), cstr(val));
    }
}

unsafe extern "C" fn get_param(
    instance: *mut c_void,
    key: *const c_char,
    buf: *mut c_char,
    buf_len: c_int,
) -> c_int {
    let Some(i) = inst(instance) else { return -1 };
    let Some(value) = i.get_param(cstr(key)) else {
        return -1;
    };
    let Ok(c) = CString::new(value) else { return -1 };
    let bytes = c.as_bytes_with_nul();
    if buf.is_null() || (buf_len as usize) < bytes.len() {
        return -1;
    }
    core::ptr::copy_nonoverlapping(bytes.as_ptr() as *const c_char, buf, bytes.len());
    (bytes.len() - 1) as c_int
}

unsafe extern "C" fn get_error(_instance: *mut c_void, _buf: *mut c_char, _buf_len: c_int) -> c_int {
    0
}

unsafe extern "C" fn render_block(instance: *mut c_void, out: *mut i16, frames: c_int) {
    if let Some(i) = inst(instance) {
        if !out.is_null() && frames > 0 {
            let slice = core::slice::from_raw_parts_mut(out, frames as usize * 2);
            i.render(slice);
        }
    }
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
