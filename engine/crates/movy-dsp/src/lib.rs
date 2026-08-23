//! movy-dsp: the cdylib boundary. Exports `move_plugin_init_v2` and adapts
//! schwung's C plugin ABI onto seq-core. All sequencing logic lives in
//! seq-core; this layer only parses params, drains engine events into host
//! MIDI sends, and renders the metronome click.

mod click;
mod ffi;
mod host;
mod chain_copy;
mod chain_cost;
mod chain_digest;
mod chain_host;
mod chain_slots;
mod render_plan;
mod render_pool;
mod load_queue;
mod mixer;
mod pad_route;

use chain_slots::ChainSlots;
use pad_route::PadRoute;
use click::Click;
use core::ffi::{c_char, c_int, c_void};
use ffi::*;
use seq_core::command::apply_batch;
use seq_core::engine::{Engine, OutEvent};
use std::ffi::{CStr, CString};

/// Split `ch<N>:<rest>` into (slot, rest). Returns None for anything that is
/// not a chain key, so unrelated keys starting with "ch" fall through.
fn parse_chain_key(key: &str) -> Option<(usize, &str)> {
    let body = key.strip_prefix("ch")?;
    let colon = body.find(':')?;
    let slot: usize = body[..colon].parse().ok()?;
    if slot >= chain_slots::MOVY_CHAINS {
        return None;
    }
    Some((slot, &body[colon + 1..]))
}

/// `"144.60.100"` -> `[0x90, 60, 100]`. Returns None on anything malformed, so
/// a garbled param cannot inject a stuck note.
fn parse_midi_triplet(val: &str) -> Option<[u8; 3]> {
    let mut it = val.split('.');
    let s: u8 = it.next()?.trim().parse().ok()?;
    let d1: u8 = it.next()?.trim().parse().ok()?;
    let d2: u8 = it.next()?.trim().parse().ok()?;
    if it.next().is_some() {
        return None;
    }
    Some([s, d1, d2])
}

/// `"0.8.-0.5.0"` -> gain 0.8, pan -0.5, unmuted. Returns None on anything
/// malformed so a garbled param cannot silence or blast a track.
fn parse_mix(val: &str) -> Option<crate::mixer::TrackMix> {
    let mut it = val.split(',');
    let gain: f32 = it.next()?.trim().parse().ok()?;
    let pan: f32 = it.next()?.trim().parse().ok()?;
    let muted = it.next()?.trim() != "0";
    if it.next().is_some() || !gain.is_finite() || !pan.is_finite() {
        return None;
    }
    Some(crate::mixer::TrackMix { gain, pan, muted })
}

const DEFAULT_BPM_X100: u32 = 12000;
const ENGINE_VERSION: &str = "0.39.0";

/// Tracks backed by schwung's own shadow slots. Their notes go out as MIDI on
/// the matching channel, exactly as before; everything above this index is a
/// chain movy hosts itself.
const HOST_TRACKS: u8 = 4;

struct Instance {
    engine: Engine,
    out: Vec<OutEvent>,
    click: Click,
    blocks: u64,
    chains: ChainSlots,
    pads: PadRoute,
}

impl Instance {
    fn new() -> Self {
        let rate = host::sample_rate();
        Instance {
            engine: Engine::new(rate, DEFAULT_BPM_X100),
            out: Vec::with_capacity(256),
            click: Click::new(rate),
            blocks: 0,
            chains: ChainSlots::new(),
            pads: PadRoute::new(),
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
            /* Ask the engine to log each chain's current output peak. The
             * remote-UI socket can WRITE an engine param but has no read verb,
             * so a device benchmark cannot poll `chpeak` — it pokes this and
             * greps the log instead. Only ever driven by a test. */
            /* "<chain>,<32 pitches>" — the UI pushes this whenever the pad
             * mapping changes, and the DSP then answers pad notes itself
             * instead of the UI paying a blocking param write per note. */
            "padmap" => {
                if !self.pads.set_map(val) {
                    host::log("padmap: refused a malformed map");
                } else {
                    // Anything still held belonged to the previous routing.
                    for (chain, pitch) in self.pads.drain_held() {
                        self.chains.on_midi(chain, &[0x80, pitch, 0], MOVE_MIDI_SOURCE_INTERNAL);
                    }
                }
            }
            "chpeaklog" => {
                host::log(&format!("chain peaks: {}", self.chains.peaks_csv()));
            }
            /* `chcostlog` — log what each chain cost per block, then start a
             * fresh window. Same write-to-read trick as `chpeaklog`; the reset
             * is what lets a benchmark discard the load phase and measure only
             * the settled set. Read by scripts/measure-chain-balance.sh. */
            "chcostlog" => {
                host::log(&format!("chain cost: {}", self.chains.cost_report()));
            }
            /* `chparallel <0|1>` — render the movy chains across helper threads.
             * Off by default and never persisted: this changes the "one thread,
             * one at a time, in slot order" contract 93 module repos were
             * written against, so it is opted into for a measurement and dropped
             * again. Toggling it mid-set is the point — A/B on one running set
             * is the only comparison that holds the chains constant. */
            "chparallel" => {
                self.chains.set_parallel(val != "0" && !val.is_empty());
            }
            /* `chlanes <n>` — how many lanes parallel render plans for, lane 0
             * being the audio thread. The design point was 3, priced by a
             * balance measurement that assumed chains cost the same however
             * many render at once; D1 measured them costing 27% more, so a lane
             * is also a cost to its neighbours and the count has to be swept on
             * the device instead of assumed (T0). `1` is the control arm: the
             * parallel path with no helpers at all. */
            "chlanes" => match val.parse::<usize>() {
                // A typo must not quietly become a one-lane run: that reads as
                // 1.00x and looks like a finding rather than a mistake.
                Ok(n) if n >= 1 => self.chains.set_lanes(n),
                _ => host::log(&format!("chain mode: ignoring chlanes '{val}'")),
            },
            /* `chdigest [blocks]` — run the equivalence oracle: strike a fixed
             * chord on every loaded chain, checksum exactly `blocks` blocks of
             * each chain's output, release. The stimulus is generated in the
             * render rather than sent over the wire because a socket write
             * lands on whatever block it lands on, and two arms that struck at
             * different points in the attack would differ for a reason that has
             * nothing to do with threading. Result is logged when the window
             * closes, and `chdigestlog` re-reads it. */
            "chdigest" => {
                let n = val.parse::<u32>().unwrap_or(chain_digest::DEFAULT_BLOCKS);
                self.chains.digest_arm(n);
            }
            /* Re-read the last digest. Separate from `chdigest` because the read
             * is an ssh round trip behind the device and may be retried; unlike
             * `chcostlog` this does NOT close a window. */
            "chdigestlog" => {
                host::log(&format!("chain digest: {}", self.chains.digest_report()));
            }
            /* `chrenderlog` — the lane assignment and how often the join had to
             * yield. Reading the plan is how a measurement tells an unbalanced
             * partition apart from fan-out latency. */
            "chrenderlog" => {
                host::log(&format!("chain render: {}", self.chains.render_report()));
            }
            /* `chlfolog <chain>` — log that chain's LFO assignments and the live
             * value of each driven param. The remote-UI socket a device test
             * drives can write but not read (see scripts/engine-param.mjs), so a
             * write that makes the engine log is the only way to observe a movy
             * chain's internals from outside. Mirrors `chpeaklog`. */
            "chlfolog" => {
                let slot: usize = val.parse().unwrap_or(0);
                host::log(&format!("chain {} lfos: {}", slot, self.chains.lfo_report(slot)));
            }
            /* Bring chain hosting up: `<schwung chain module dir>|<movy dir>`.
             * The UI sends it once at boot because only the UI knows the
             * install paths. Refreshing movy's private copy and dlopening it
             * both happen here — off the render path, once. */
            "chain_host" => {
                let mut parts = val.splitn(2, '|');
                if let (Some(src_dir), Some(movy_dir)) = (parts.next(), parts.next()) {
                    let src = format!("{}/dsp.so", src_dir);
                    let dst = format!("{}/chain-dsp.so", movy_dir);
                    match chain_copy::ensure_copy(&src, &dst) {
                        Ok(_) => self.chains.configure(src_dir, &dst),
                        Err(e) => host::log(&format!("chain host copy failed: {}", e)),
                    }
                }
            }
            // Load persisted state (UI sends the autosave file's contents).
            "state" => {
                if seq_core::persist::load(&mut self.engine, val) {
                    self.engine.dirty = false;
                }
            }
            /* `ch<N>:<rest>` addresses movy chain N (0-11 = tracks 5-16).
             * Module loads are diverted into the queue so they cannot bypass
             * the one-load-per-callback rule; everything else is a plain
             * forward. */
            _ if key.starts_with("ch") => {
                if let Some((slot, rest)) = parse_chain_key(key) {
                    if let Some(component) = rest.strip_suffix(":module") {
                        self.chains.request_load(slot, component, val);
                    } else if let Some(component) = rest.strip_suffix(":state") {
                        /* Ordered against the module load rather than racing it
                         * — see ChainSlots::set_state. */
                        self.chains.set_state(slot, component, val);
                    } else if rest == "mix" {
                        // "gain.pan.muted" — movy owns these because Move's
                        // mixer sees all twelve chains as one channel.
                        if let Some(mix) = parse_mix(val) {
                            self.chains.set_mix(slot, mix);
                        }
                    } else if rest == "midi" {
                        // Live pad notes: "status.d1.d2". A movy chain cannot be
                        // reached by shadow_send_midi_to_dsp, which addresses
                        // schwung's slots.
                        if let Some(msg) = parse_midi_triplet(val) {
                            self.chains.on_midi(slot, &msg, MOVE_MIDI_SOURCE_INTERNAL);
                        }
                    } else {
                        self.chains.set_param(slot, rest, val);
                    }
                }
            }
            _ => {}
        }
    }

    fn get_param(&mut self, key: &str) -> Option<String> {
        match key {
            /* `unop` rides along here rather than inside status(): draining it
             * needs &mut, and status() is deliberately a pure read. The UI
             * pushes undo entries optimistically and retracts on this id when
             * the engine found the group changed nothing. */
            "status" => {
                let mut s = self.engine.status();
                if let Some(id) = self.engine.undo.take_noop() {
                    s.push_str(&format!(" unop={id}"));
                }
                /* Rides the existing poll rather than costing its own IPC: the
                 * UI needs to notice a chain change to persist it, and status
                 * is the one thing it already reads every few ticks. */
                s.push_str(&format!(" chgen={} chact={}",
                    self.chains.generation(), self.chains.active_count()));
                Some(s)
            }
            "capinfo" => Some(self.engine.capture_info()),
            "alabels" => Some(self.engine.auto_labels()),
            "ping" => Some(format!("pong {ENGINE_VERSION}")),
            // Serialize for autosave; reading it clears the dirty flag (the UI
            // is about to persist exactly this snapshot).
            "state" => {
                let s = seq_core::persist::serialize(&self.engine);
                self.engine.dirty = false;
                Some(s)
            }
            "chgen" => Some(self.chains.generation().to_string()),
            "chpeak" => Some(self.chains.peaks_csv()),
            "diag" => Some(format!(
                "blocks={} out_cap={} chains={} pending={} active={}",
                self.blocks,
                self.out.capacity(),
                self.chains.is_available() as u8,
                self.chains.pending_loads(),
                self.chains.active_count()
            )),
            _ if key.starts_with("ch") => {
                let (slot, rest) = parse_chain_key(key)?;
                self.chains.get_param(slot, rest)
            }
            _ => None,
        }
    }

    /// Turn engine events into host MIDI sends + metronome triggers. Indexes
    /// `out` (events are Copy) so `click` can be borrowed in the same pass,
    /// then clears it — preserving the buffer's capacity across blocks.
    fn drain_out(&mut self) {
        for i in 0..self.out.len() {
            match self.out[i] {
                /* The one place that knows where a track's notes go. A host
                 * track is addressed by MIDI channel; a movy track is a chain
                 * movy owns, so its note never leaves this process. */
                OutEvent::NoteOn { track, pitch, vel } => {
                    if track < HOST_TRACKS {
                        host::midi_send_internal(0x90 | track, pitch, vel);
                    } else {
                        self.chains.on_midi(
                            (track - HOST_TRACKS) as usize,
                            &[0x90, pitch, vel],
                            MOVE_MIDI_SOURCE_INTERNAL,
                        );
                    }
                }
                OutEvent::NoteOff { track, pitch } => {
                    if track < HOST_TRACKS {
                        host::midi_send_internal(0x80 | track, pitch, 0);
                    } else {
                        self.chains.on_midi(
                            (track - HOST_TRACKS) as usize,
                            &[0x80, pitch, 0],
                            MOVE_MIDI_SOURCE_INTERNAL,
                        );
                    }
                }
                OutEvent::Click { accent } => {
                    self.click.trigger(accent);
                }
                OutEvent::Cc { track, lane, val } => {
                    if track < HOST_TRACKS {
                        host::midi_send_internal(0xB0 | track, 102 + lane, val);
                    } else {
                        self.chains.on_midi(
                            (track - HOST_TRACKS) as usize,
                            &[0xB0, 102 + lane, val],
                            MOVE_MIDI_SOURCE_INTERNAL,
                        );
                    }
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
                OutEvent::MoveInject { val } => {
                    // MovePlay (CC 85) toward Move's firmware — davebox packet
                    // shape [0x0B, 0xB0, 85, val] (design §7 Phase 4).
                    host::midi_inject_to_move(0x0B, 0xB0, 85, val);
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
        /* At most ONE queued module load per block. This is the blocking call —
         * it dlopens — and releasing one per callback is what stops a twelve
         * chain restore stacking into a single block (see load_queue). */
        self.chains.service_loads();
        self.chains.render(out_audio);
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
        /* Does the shim deliver PAD notes here? schwung_shim.c:6950 delivers
         * internal cable-0 note events (d1 >= 10) to the overtake DSP's on_midi
         * on the audio thread, explicitly so an overtake tool can take pad input
         * without a JS round trip. Movy's pad path currently costs a blocking
         * param write per note (measured: 2.12 ms of IPC per tick, against 0.30
         * for a host track), so using this would remove it entirely.
         *
         * It cannot be confirmed by injection: writes to /dev/shm/schwung-ui-midi
         * enter the UI ring, while that delivery sits in the HARDWARE MIDI scan.
         * One physical pad press settles it. Logged once, then free. */
        /* Live pads, handled here on the AUDIO THREAD rather than costing the
         * UI a blocking param write per note (see pad_route). The UI stops
         * sending them itself while a map is active, so this is the only
         * source — hence the ledger inside PadRoute. */
        if len >= 3 {
            let d1 = unsafe { *msg.add(1) };
            let d2 = unsafe { *msg.add(2) };
            if let Some(i) = inst(instance) {
                if let Some((chain, pitch, on)) = i.pads.route(status, d1, d2) {
                    let m = if on { [0x90, pitch, d2] } else { [0x80, pitch, 0] };
                    i.chains.on_midi(chain, &m, MOVE_MIDI_SOURCE_INTERNAL);
                    return;
                }
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_mix_setting() {
        let m = parse_mix("0.8,-0.5,0").unwrap();
        assert!((m.gain - 0.8).abs() < 1e-6);
        assert!((m.pan + 0.5).abs() < 1e-6);
        assert!(!m.muted);
        assert!(parse_mix("1,0,1").unwrap().muted);
    }

    #[test]
    fn rejects_a_malformed_mix() {
        // A garbled param must not silence a track or send it to full scale.
        for bad in ["", "1", "1,0", "1,0,0,0", "x,0,0", "nan,0,0", "inf,0,0"] {
            assert!(parse_mix(bad).is_none(), "{:?} must be rejected", bad);
        }
    }

    #[test]
    fn parses_a_midi_triplet() {
        assert_eq!(parse_midi_triplet("144.60.100"), Some([0x90, 60, 100]));
        assert_eq!(parse_midi_triplet("128.60.0"), Some([0x80, 60, 0]));
    }

    #[test]
    fn rejects_a_malformed_triplet() {
        // A garbled param must not inject a note that never gets released.
        for bad in ["", "144", "144.60", "144.60.100.7", "144.x.100", "999.60.100"] {
            assert_eq!(parse_midi_triplet(bad), None, "{:?} must be rejected", bad);
        }
    }

    #[test]
    fn parses_a_chain_key() {
        assert_eq!(parse_chain_key("ch0:synth:cutoff"), Some((0, "synth:cutoff")));
        assert_eq!(parse_chain_key("ch11:fx1:wet"), Some((11, "fx1:wet")));
    }

    #[test]
    fn rejects_slots_that_cannot_exist() {
        // Would otherwise index past the slot vector, or silently address the
        // wrong chain.
        assert_eq!(parse_chain_key("ch12:synth:cutoff"), None);
        assert_eq!(parse_chain_key("ch99:synth:cutoff"), None);
    }

    #[test]
    fn ignores_keys_that_merely_start_with_ch() {
        // The dispatch arm is `key.starts_with("ch")`, so anything it does not
        // recognise must fall through rather than be eaten.
        assert_eq!(parse_chain_key("chain_host"), None);
        assert_eq!(parse_chain_key("cheese"), None);
        assert_eq!(parse_chain_key("ch:synth"), None);
        assert_eq!(parse_chain_key("chx:synth"), None);
    }

    #[test]
    fn keeps_the_whole_remainder_including_colons() {
        // `fx1:wet` must arrive at the chain intact, not truncated at the first
        // colon after the slot number.
        assert_eq!(parse_chain_key("ch3:master_fx:fx1:wet"), Some((3, "master_fx:fx1:wet")));
    }

    #[test]
    fn module_loads_are_recognised_by_suffix() {
        let (slot, rest) = parse_chain_key("ch5:synth:module").unwrap();
        assert_eq!(slot, 5);
        assert_eq!(rest.strip_suffix(":module"), Some("synth"),
            "the component name is what the queue needs");
    }
}
