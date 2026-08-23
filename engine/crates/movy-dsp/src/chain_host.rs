//! Loading schwung's chain host so movy can own private chain instances.
//!
//! `modules/chain/dsp.so` is already multi-instance — schwung runs four of them,
//! one per shadow slot — and it implements the same `plugin_api_v2` movy itself
//! is loaded through. A chain instance with a synth loaded IS a track: MIDI in,
//! stereo out, params and presets included.
//!
//! **Why movy loads a COPY.** `move_plugin_init_v2` assigns a file-global
//! `g_host` (chain_host.c:2082). dlopen'ing the same realpath twice shares one
//! mapping, so initialising it from movy would overwrite the pointer schwung's
//! own four instances share. A separate file gets a separate mapping and a
//! separate `g_host`. A symlink does NOT work — dlopen resolves it to the same
//! realpath. The copy is a cache of the installed file, never a fork: it is
//! refreshed whenever the source differs, so it tracks whatever schwung version
//! the user has (design §6.1).
//!
//! **The module_dir is deliberately NOT movy's own.** `create_instance` is
//! passed schwung's chain module directory, because the chain host resolves FX
//! as `<module_dir>/../audio_fx/<name>/<name>.so` (chain_host.c:245). Passing
//! movy's directory would resolve against movy's parent and find no FX at all;
//! passing schwung's gives movy every audio FX the user installed, with no
//! movy-side registry.

use crate::ffi::{host_api_v1_t, plugin_api_v2_t};
use crate::host;
use crate::midi_out::QUEUE;
use core::ffi::{c_char, c_int, c_void};
use std::ffi::{CStr, CString};
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;

extern "C" {
    fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn dlerror() -> *mut c_char;
}

const RTLD_NOW: c_int = 2;
const RTLD_LOCAL: c_int = 0;

/// The API version movy is compiled against. Asserted before ANY other field of
/// the returned struct is touched — it is the first member of `plugin_api_v2`
/// (plugin_api_v1.h:205), so it is readable even if everything after it moved.
/// A silent reorder within the same version is caught at test time instead, by
/// `browser-test/abi-parity.mjs`.
const EXPECTED_API_VERSION: u32 = 2;

type PluginInitFn = unsafe extern "C" fn(host: *const host_api_v1_t) -> *mut plugin_api_v2_t;

/// The vtable movy's chains see: schwung's, with the two single-producer MIDI
/// sends replaced by wrappers that park a call made from inside a render.
///
/// Built once and leaked for the process lifetime, because the chain host keeps
/// the pointer in its own `g_host` and dereferences it on the audio thread for
/// as long as any chain exists. An `AtomicPtr` and not a `OnceLock` only because
/// the struct holds raw pointers and so is not `Sync`; `load` is reached from a
/// param set, never from render, so the init race is theoretical.
static SHIMMED_HOST: AtomicPtr<host_api_v1_t> = AtomicPtr::new(core::ptr::null_mut());

unsafe extern "C" fn shim_send_internal(msg: *const u8, len: c_int) -> c_int {
    shim_send(msg, len, false)
}

unsafe extern "C" fn shim_send_external(msg: *const u8, len: c_int) -> c_int {
    shim_send(msg, len, true)
}

/// Park the call if a chain is rendering on this thread, otherwise forward it
/// untouched. The forward path is what movy's own engine sends take, and it is
/// the same pointer schwung installed — one extra branch, no behaviour change.
unsafe fn shim_send(msg: *const u8, len: c_int, external: bool) -> c_int {
    if msg.is_null() || len <= 0 {
        return 0;
    }
    let slice = core::slice::from_raw_parts(msg, len as usize);
    if let Some(n) = QUEUE.park(slice, external) {
        return n;
    }
    // Not inside a render: straight through to schwung's own sender, saved
    // before the copy's pointers were overwritten. Calling back through the
    // copy would recurse.
    let Some((int_fn, ext_fn)) = ORIGINALS.get() else { return 0 };
    match if external { *ext_fn } else { *int_fn } {
        Some(f) => f(msg, len),
        None => 0,
    }
}

type SendFn = unsafe extern "C" fn(msg: *const u8, len: c_int) -> c_int;

/// Schwung's own `(internal, external)` senders, saved before the copy's
/// pointers are overwritten. The drain and the pass-through both go here.
static ORIGINALS: OnceLock<(Option<SendFn>, Option<SendFn>)> = OnceLock::new();

/// Replay one parked message to schwung. Audio thread, after the join.
pub fn send_direct(msg: &[u8], external: bool) {
    let Some((int_fn, ext_fn)) = ORIGINALS.get() else { return };
    let f = if external { *ext_fn } else { *int_fn };
    if let Some(f) = f {
        unsafe { f(msg.as_ptr(), msg.len() as c_int) };
    }
}

/// Copy schwung's host vtable and swap in the two wrappers.
///
/// A COPY and not a mutation of schwung's own struct: that struct is shared with
/// schwung's four native chain slots and with every other module in the process,
/// and none of them renders on a movy lane. Only movy's chains get the wrappers.
fn shimmed_host() -> *const host_api_v1_t {
    let raw = host::raw();
    if raw.is_null() {
        return raw;
    }
    let existing = SHIMMED_HOST.load(Ordering::Acquire);
    if !existing.is_null() {
        return existing;
    }
    // Safe: schwung hands movy this pointer at plugin init and it outlives the
    // process. The struct is mirrored in full (see `ffi.rs`), which
    // `abi-parity.mjs` asserts, so the copy carries every field the chain host
    // reads — `slot_recv_channel` and `get_beat_position` included.
    let mut copy = unsafe { core::ptr::read(raw) };
    let _ = ORIGINALS.set((copy.midi_send_internal, copy.midi_send_external));
    copy.midi_send_internal = Some(shim_send_internal);
    copy.midi_send_external = Some(shim_send_external);
    let leaked: *mut host_api_v1_t = Box::leak(Box::new(copy));
    SHIMMED_HOST.store(leaked, Ordering::Release);
    leaked
}

pub struct ChainHost {
    api: &'static plugin_api_v2_t,
}

fn last_dlerror() -> String {
    unsafe {
        let e = dlerror();
        if e.is_null() {
            "unknown".to_string()
        } else {
            CStr::from_ptr(e).to_string_lossy().into_owned()
        }
    }
}

impl ChainHost {
    /// dlopen movy's private copy and initialise it against movy's own host API.
    ///
    /// Every failure returns `Err` rather than panicking: movy must keep
    /// sequencing its four host tracks even when chain hosting is unavailable,
    /// and an unavailable chain host is a degraded feature, not a broken tool.
    pub fn load(so_path: &str) -> Result<Self, String> {
        let path = CString::new(so_path).map_err(|_| "so path has an interior NUL".to_string())?;

        let handle = unsafe { dlopen(path.as_ptr(), RTLD_NOW | RTLD_LOCAL) };
        if handle.is_null() {
            return Err(format!("dlopen {} failed: {}", so_path, last_dlerror()));
        }

        let sym = CString::new("move_plugin_init_v2").unwrap();
        let init_ptr = unsafe { dlsym(handle, sym.as_ptr()) };
        if init_ptr.is_null() {
            return Err(format!("{} exports no move_plugin_init_v2", so_path));
        }
        let init: PluginInitFn = unsafe { core::mem::transmute(init_ptr) };

        // The shimmed vtable, not schwung's own — see `shimmed_host`. Every
        // module in every movy chain is handed this, which is what makes the
        // "one producer behind midi_send_*" promise movy's to keep.
        let api_ptr = unsafe { init(shimmed_host()) };
        if api_ptr.is_null() {
            return Err("move_plugin_init_v2 returned NULL".to_string());
        }

        // Read api_version FIRST. Anything else is only meaningful once the
        // layout is confirmed.
        let version = unsafe { (*api_ptr).api_version };
        if version != EXPECTED_API_VERSION {
            return Err(format!(
                "chain host reports plugin API v{}, movy speaks v{} — refusing to host chains",
                version, EXPECTED_API_VERSION
            ));
        }

        let api: &'static plugin_api_v2_t = unsafe { &*api_ptr };

        // Every entry point movy actually calls. A NULL here means the host was
        // built without something movy needs; degrade with a message rather than
        // discovering it as a null-pointer call on the audio thread.
        for (name, present) in [
            ("create_instance", api.create_instance.is_some()),
            ("destroy_instance", api.destroy_instance.is_some()),
            ("set_param", api.set_param.is_some()),
            ("get_param", api.get_param.is_some()),
            ("on_midi", api.on_midi.is_some()),
            ("render_block", api.render_block.is_some()),
        ] {
            if !present {
                return Err(format!("chain host is missing {}", name));
            }
        }

        host::log(&format!("chain host loaded from {} (api v{})", so_path, version));
        Ok(Self { api })
    }

    /// Create one chain instance. `module_dir` must be SCHWUNG's chain module
    /// directory — see the note at the top of this file.
    pub fn create_instance(&self, module_dir: &str) -> Option<ChainInstance> {
        let dir = CString::new(module_dir).ok()?;
        let f = self.api.create_instance?;
        let inst = unsafe { f(dir.as_ptr(), core::ptr::null()) };
        if inst.is_null() {
            host::log(&format!("chain create_instance failed for {}", module_dir));
            return None;
        }
        Some(ChainInstance { inst, api: self.api, scratch: vec![0u8; PARAM_BUF] })
    }
}

/// Largest value the param channel can carry (SHADOW_PARAM_VALUE_LEN), so a
/// value that does not fit here could not cross to the UI anyway.
///
/// It has to be this big: a module's `chain_params` / `ui_hierarchy` JSON is the
/// UI's entire description of itself, and dexed's is ~13.5 KB. Reading it into a
/// 4 KB buffer truncated it mid-JSON — the module loaded (its id is short) but
/// every page came out wrong, which is exactly how it looked on device.
const PARAM_BUF: usize = 64 * 1024;

/// One movy-owned chain: a track's MIDI FX, synth and audio FX.
pub struct ChainInstance {
    inst: *mut c_void,
    api: &'static plugin_api_v2_t,
    /// Reusable read buffer. Allocated once at load time — get_param is served
    /// from the shim's param handler on the AUDIO thread, where a per-call
    /// allocation of this size would be a real-time hazard.
    scratch: Vec<u8>,
}

impl ChainInstance {
    /// Set a param on the chain. **Loading keys (`synth:module`, `fx*:module`,
    /// `load_file`) do blocking file I/O inside this call** — that is why they
    /// are released one per audio callback (see `load_queue`).
    pub fn set_param(&mut self, key: &str, val: &str) {
        let (Ok(k), Ok(v)) = (CString::new(key), CString::new(val)) else { return };
        if let Some(f) = self.api.set_param {
            unsafe { f(self.inst, k.as_ptr(), v.as_ptr()) };
        }
    }

    pub fn get_param(&mut self, key: &str) -> Option<String> {
        let k = CString::new(key).ok()?;
        let f = self.api.get_param?;
        let cap = self.scratch.len();
        let n = unsafe { f(self.inst, k.as_ptr(), self.scratch.as_mut_ptr() as *mut c_char, cap as c_int) };
        if n <= 0 {
            return None;
        }
        let n = n as usize;
        if n >= cap {
            // Truncated: better to refuse than to hand the UI half a JSON
            // document it will parse into a wrong page layout.
            host::log(&format!("chain get_param {} truncated at {} bytes", key, cap));
            return None;
        }
        Some(String::from_utf8_lossy(&self.scratch[..n]).into_owned())
    }

    pub fn on_midi(&mut self, msg: &[u8], source: c_int) {
        if let Some(f) = self.api.on_midi {
            unsafe { f(self.inst, msg.as_ptr(), msg.len() as c_int, source) };
        }
    }

    /// Render one block. The chain OVERWRITES `out`, so callers render into a
    /// scratch buffer and sum — it is not an accumulate.
    pub fn render_block(&mut self, out: &mut [i16]) {
        if let Some(f) = self.api.render_block {
            unsafe { f(self.inst, out.as_mut_ptr(), (out.len() / 2) as c_int) };
        }
    }

    /// The raw entry point, for the render pool to call from a helper thread.
    ///
    /// Handing out the function pointer and instance rather than a `&mut self`
    /// keeps the pool free of any view into chain state, so its safety argument
    /// is about a partition of pointers and nothing else. `&mut self` because
    /// this is still an exclusive claim on the instance for the round.
    pub fn raw_render(&mut self) -> Option<(RenderFn, *mut c_void)> {
        self.api.render_block.map(|f| (f, self.inst))
    }
}

/// `plugin_api_v2_t::render_block`, unwrapped from its `Option`.
pub type RenderFn = unsafe extern "C" fn(*mut c_void, *mut i16, c_int);

impl Drop for ChainInstance {
    fn drop(&mut self) {
        if let Some(f) = self.api.destroy_instance {
            unsafe { f(self.inst) };
        }
    }
}
