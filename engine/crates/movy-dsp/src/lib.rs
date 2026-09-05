//! movy-dsp: the cdylib boundary. Exports `move_plugin_init_v2` and adapts
//! schwung's C plugin ABI onto seq-core. All sequencing logic lives in
//! seq-core; this layer only parses params, drains engine events into host
//! MIDI sends, and renders the metronome click.

mod click;
mod ffi;
mod host;
mod chain_copy;
mod chain_doc;
mod chain_cost;
mod chain_digest;
mod chain_idle;
mod midi_out;
mod chain_host;
mod chain_slots;
mod chain_pin;
mod render_plan;
mod render_pool;
mod load_queue;
mod mixer;
mod send_bus;
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

/// `snd0:module` -> `(0, "module")`.
///
/// A send bus is not a track and never takes a `ch<N>` key — `ch<N>` IS track
/// N. Out-of-range buses are refused rather than clamped: a write meant for a
/// bus that does not exist must not land on one that does.
fn parse_send_key(key: &str) -> Option<(usize, &str)> {
    let body = key.strip_prefix("snd")?;
    let colon = body.find(':')?;
    let bus: usize = body[..colon].parse().ok()?;
    if bus >= send_bus::SEND_BUSES {
        return None;
    }
    Some((bus, &body[colon + 1..]))
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
/// `gain,pan,muted` or `gain,pan,muted,send1,send2`.
///
/// Three fields is the legacy form every set saved before sends existed
/// carries, and it must keep restoring — at zero sends, not at whatever the
/// slot happened to hold. A lone fourth field is half a pair and is refused
/// whole: applying a send level nothing wrote is worse than refusing the value.
fn parse_mix(val: &str) -> Option<crate::mixer::TrackMix> {
    let mut it = val.split(',');
    let gain: f32 = it.next()?.trim().parse().ok()?;
    let pan: f32 = it.next()?.trim().parse().ok()?;
    let muted = it.next()?.trim() != "0";
    let mut send = [0.0f32; 2];
    match (it.next(), it.next(), it.next()) {
        (None, _, _) => {}
        (Some(a), Some(b), None) => {
            send[0] = a.trim().parse().ok()?;
            send[1] = b.trim().parse().ok()?;
        }
        _ => return None,
    }
    if !gain.is_finite() || !pan.is_finite() || !send.iter().all(|s| s.is_finite()) {
        return None;
    }
    Some(crate::mixer::TrackMix { gain, pan, muted, send })
}

const DEFAULT_BPM_X100: u32 = 12000;
const ENGINE_VERSION: &str = "0.63.0";

/// Tracks backed by schwung's own shadow slots by default. Their notes go out as
/// MIDI on the matching channel; everything above this index is a chain movy
/// hosts itself. `chtracks` moves these four onto chains as well.
const HOST_TRACKS: u8 = 4;

/// Where a track's output goes: `None` = out as MIDI on the track's own channel,
/// which is how a schwung shadow slot is addressed; `Some(chain)` = a chain movy
/// hosts, whose note never leaves this process.
///
/// **A track's chain is its own index.** It was `track - HOST_TRACKS` while movy
/// hosted twelve chains numbered from zero, and that offset had to be deleted in
/// two languages at once: the UI addresses `ch<N>` for track N, so an engine
/// still subtracting four sequences track 4's notes into track 0's synth. Wrong
/// instrument, no error, nothing in any log.
fn chain_for(track: u8, movy_tracks: bool) -> Option<usize> {
    if track < HOST_TRACKS && !movy_tracks {
        None
    } else {
        Some(track as usize)
    }
}

struct Instance {
    engine: Engine,
    out: Vec<OutEvent>,
    click: Click,
    blocks: u64,
    chains: ChainSlots,
    pads: PadRoute,
    /// `chtracks`: tracks 0..3 are movy chains rather than schwung shadow slots.
    /// Pushed by the UI on every engine boot — the UI is the one that knows,
    /// because it is where the setting lives.
    movy_tracks: bool,
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
            movy_tracks: false,
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
            /* `padvel <0|1>` — Full Velocity (Shift + Step 10). The engine has to
             * be told because it is the one building the note-on: for a movy
             * track the UI does not send pad notes at all, so applying it only
             * on the UI's own send left the toggle audible on host tracks and
             * silent everywhere else. Pushed by comparison beside `padmap`, so
             * a re-dlopened engine is told again. */
            "padvel" => {
                let on = val != "0" && !val.is_empty();
                self.pads.set_full_velocity(on);
                /* Logged like `chtracks`: it only ever moves on a deliberate
                 * gesture, and it is the one place a device check can see that
                 * the UI's toggle reached the thread that builds the note. */
                host::log(&format!("pad velocity: {}", if on { "full" } else { "as played" }));
            }
            /* `chtracks <0|1>` — tracks 0..3 render on movy chains instead of
             * schwung's shadow slots. The UI acts on this too (it re-points
             * every port), but the ENGINE has to know as well: it sequences the
             * notes, and `drain_out` is the one place that decides whether a
             * track's note goes out as MIDI or into a chain. Without this the
             * flag moves the UI and leaves every sequenced note going to
             * schwung — which is exactly how it shipped broken. */
            "chtracks" => {
                self.movy_tracks = val != "0" && !val.is_empty();
                host::log(&format!(
                    "chain tracks: 0-3 -> {}",
                    if self.movy_tracks { "movy chains" } else { "schwung slots" }
                ));
            }
            /* `chloadedlog` — log what each movy chain actually holds, then
             * carry on. Write-to-read, the same trick as `chpeaklog`, and for
             * a harsher reason: a device test has no other way to read a movy
             * chain back at all, and the load line is silent for a set that is
             * already correct. Read by scripts/lib/test-set.sh. */
            "chloadedlog" => {
                host::log(&format!("chain loaded: {}", self.chains.loaded_report()));
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
            /* `cpurst` — clear the CPU page's held peaks. Deliberately NOT
             * `chcostlog`: that closes the window `measure-chain-balance.sh`
             * owns, and a peak the user is looking at must survive a device
             * script reading the log. */
            "cpurst" => {
                self.chains.cost_ui_reset();
            }
            /* `cpulog` — log exactly what the CPU page reads. Same write-to-read
             * trick as `chpeaklog`, and for the same reason: the remote-UI
             * socket a device test drives can write but not read, so this is the
             * only way to see the meter's numbers from outside. Unlike
             * `chcostlog` it closes no window — the page's peaks are held until
             * `cpurst`. */
            "cpulog" => {
                host::log(&format!("cpu:{}", self.chains.cost_status()));
            }
            /* `chparallel <0|1>` — render the movy chains across helper threads.
             * The UI's default is now ON (`flags-def.ts`), because the measured
             * 2.0-2.2x is what puts several synths under the frame budget at
             * all. The ENGINE's default stays serial, deliberately: the UI
             * pushes every flag on each engine boot, so the product default is
             * never in doubt, while a device script writing `1` still gets a log
             * line rather than the silence of a no-op write.
             *
             * It remains a runtime toggle because this changes the "one thread,
             * one at a time, in slot order" contract 93 module repos were
             * written against — and because A/B on one running set is the only
             * comparison that holds the chains constant. */
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
            /* `chpin <0|1>` — pin EVERY duplicated module to one lane, not just
             * the blacklisted ones. Off by default, because modules are assumed
             * thread-safe (chain_pin). It is the blunt containment for a set
             * that misbehaves before anyone knows which module is at fault, and
             * the conservative arm of a measurement. Pointless unless
             * `chparallel` is on, since serial render has one thread either
             * way. */
            "chpin" => {
                self.chains.set_pin_duplicates(val != "0" && !val.is_empty());
            }
            /* `chblock <csv>` — modules proven to race, whose instances all go
             * back on one lane. Replaces the list wholesale, so an empty value
             * clears it. The UI sends it from prefs.json on every engine boot;
             * unlike the flags this is a hazard list, so it is policy the user
             * adds to when a module misbehaves rather than a tuning knob. */
            /* `chidle <0|1|2|3>` — skip work for chains that are making no
             * sound. An ordinal because the FX gate depends on the synth gate:
             * 0 is today's single render_block call, 1 splits synth from FX but
             * never sleeps (the arm chdigest compares against 0), 2 sleeps a
             * silent synth, 3 also sleeps a silent FX tail. Default 3 — unlike
             * chparallel this is meant to be on, so an unrecognised value reads
             * as the default rather than as off. */
            "chidle" => {
                self.chains.set_idle_level(crate::chain_idle::IdleLevel::from_flag(val));
            }
            /* Log the idle gate's state. Same write-to-read trick as
             * `chcostlog`: `diag` and `status` carry the same numbers, but the
             * remote-UI socket a benchmark drives has no read verb. */
            "chidlelog" => {
                host::log(&format!("chain idle: {}", self.chains.idle_report()));
            }
            "chblock" => {
                self.chains.set_blacklist(val);
            }
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
            /* `chmidilog` — how much render-emitted MIDI the queue had to
             * refuse. Non-zero means a module burst past `midi_out::CAP` in one
             * block and lost messages; zero is the expected reading, since no
             * fleet module sends from render at all today. */
            "chmidilog" => {
                host::log(&format!("chain midi: {}", midi_out::QUEUE.report()));
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
            /* The whole chain set in one message. It used to cross as one
             * unacknowledged write per component, and the writes that could not
             * be serviced while an earlier load held the audio thread were
             * dropped in silence — then the next save read back what had
             * survived and wrote the shrunken set to disk. One document can be
             * acknowledged, and retried whole when it is not. */
            "chains" => {
                if !self.chains.set_chain_set(val) {
                    host::log("chains: malformed set document ignored");
                }
            }
            // Load persisted state (UI sends the autosave file's contents).
            "state" => {
                if seq_core::persist::load(&mut self.engine, val) {
                    self.engine.dirty = false;
                }
            }
            /* `snd<n>:<rest>` addresses send bus n. Module loads are diverted
             * into the same queue chain loads use, so a set that opens with two
             * sends cannot stack their dlopens into one audio callback. */
            _ if key.starts_with("snd") => {
                if let Some((bus, rest)) = parse_send_key(key) {
                    match rest {
                        "module" => self.chains.request_send_load(bus, val),
                        "state" => self.chains.set_send_state(bus, val),
                        _ => self.chains.send_param(bus, rest, val),
                    }
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
                s.push_str(&format!(" chgen={} chact={} chslp={} chpend={}",
                    self.chains.generation(), self.chains.active_count(),
                    self.chains.asleep_count(), self.chains.pending_loads()));
                /* Rides the same poll, for the same reason: the CPU page
                 * repaints from `status` and must not buy an IPC of its own. */
                s.push_str(&self.chains.cost_status());
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
            /* What was REQUESTED, not what has finished loading: loads are
             * released one per audio callback, so a save taken mid-drain must
             * still report the whole set. */
            "chains" => Some(self.chains.chain_set()),
            "chgen" => Some(self.chains.generation().to_string()),
            "chpeak" => Some(self.chains.peaks_csv()),
            "diag" => Some(format!(
                "blocks={} out_cap={} chains={} pending={} active={} asleep={}",
                self.blocks,
                self.out.capacity(),
                self.chains.is_available() as u8,
                self.chains.pending_loads(),
                self.chains.active_count(),
                self.chains.asleep_count()
            )),
            _ if key.starts_with("snd") => {
                let (bus, rest) = parse_send_key(key)?;
                /* The chain host publishes a loaded module under an underscore
                 * alias, not the colon key it was set with. Reading back the
                 * key we wrote answers "absent", and the UI then draws a loaded
                 * send slot as "click jog to add". */
                if rest == "module" {
                    return self.chains.send_get_param(bus, "fx1_module");
                }
                self.chains.send_get_param(bus, rest)
            }
            _ if key.starts_with("ch") => {
                let (slot, rest) = parse_chain_key(key)?;
                /* Symmetric with set_param: the mix is movy's own state, not
                 * any chain-host param, so forwarding this to the instance
                 * answered "no such param" and the caller read unity. */
                if rest == "mix" {
                    return self.chains.mix_csv(slot);
                }
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
                    match chain_for(track, self.movy_tracks) {
                        None => {
                            host::midi_send_internal(0x90 | track, pitch, vel);
                        }
                        Some(c) => {
                            self.chains.on_midi(
                                c,
                                &[0x90, pitch, vel],
                                MOVE_MIDI_SOURCE_INTERNAL,
                            );
                        }
                    }
                }
                OutEvent::NoteOff { track, pitch } => {
                    match chain_for(track, self.movy_tracks) {
                        None => {
                            host::midi_send_internal(0x80 | track, pitch, 0);
                        }
                        Some(c) => {
                            self.chains.on_midi(
                                c,
                                &[0x80, pitch, 0],
                                MOVE_MIDI_SOURCE_INTERNAL,
                            );
                        }
                    }
                }
                OutEvent::Click { accent } => {
                    self.click.trigger(accent);
                }
                OutEvent::Cc { track, lane, val } => {
                    match chain_for(track, self.movy_tracks) {
                        None => {
                            host::midi_send_internal(0xB0 | track, 102 + lane, val);
                        }
                        Some(c) => {
                            self.chains.on_midi(
                                c,
                                &[0xB0, 102 + lane, val],
                                MOVE_MIDI_SOURCE_INTERNAL,
                            );
                        }
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
                if let Some((chain, pitch, vel, on)) = i.pads.route(status, d1, d2) {
                    let m = if on { [0x90, pitch, vel] } else { [0x80, pitch, 0] };
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
    fn a_legacy_three_field_mix_parses_with_no_sends() {
        // Sets saved before sends existed must restore, silently, at zero.
        let m = parse_mix("0.5,-0.25,0").expect("three fields is still valid");
        assert_eq!(m.gain, 0.5);
        assert_eq!(m.pan, -0.25);
        assert!(!m.muted);
        assert_eq!(m.send, [0.0, 0.0]);
    }

    #[test]
    fn a_five_field_mix_carries_the_sends() {
        let m = parse_mix("1.0,0.0,0,0.25,0.75").expect("five fields is valid");
        assert_eq!(m.send, [0.25, 0.75]);
    }

    #[test]
    fn a_partial_send_pair_is_refused_whole() {
        // Half a pair is not a mix this build can honour: applying a level
        // nothing wrote is worse than refusing the value.
        assert!(parse_mix("1.0,0.0,0,0.25").is_none());
        assert!(parse_mix("1.0,0.0,0,0.25,0.5,0.5").is_none());
        assert!(parse_mix("1.0,0.0,0,nan,0.5").is_none());
    }

    #[test]
    fn rejects_a_malformed_mix() {
        // A garbled param must not silence a track or send it to full scale.
        for bad in ["", "1", "1,0", "1,0,0,0", "x,0,0", "nan,0,0", "inf,0,0"] {
            assert!(parse_mix(bad).is_none(), "{:?} must be rejected", bad);
        }
    }

    /* End to end through the param wire, because the bug was in the ROUTING:
     * `ch<N>:mix` was forwarded to the chain instance, which has no such key,
     * so every read answered "absent" and callers fell back to unity — the
     * volume gesture restarted at 0 dB and a save had nothing to record. */
    #[test]
    fn a_chain_mix_round_trips_through_the_param_wire() {
        let mut inst = Instance::new();
        assert_eq!(inst.get_param("ch4:mix").as_deref(), Some("1.0000,0.0000,0,0.0000,0.0000"));
        inst.set_param("ch4:mix", "0.3162,0,0");
        assert_eq!(inst.get_param("ch4:mix").as_deref(), Some("0.3162,0.0000,0,0.0000,0.0000"),
                   "a legacy three-field write reads back in the five-field form");
        inst.set_param("ch4:mix", "0.3162,0,0,0.5,0.25");
        assert_eq!(inst.get_param("ch4:mix").as_deref(), Some("0.3162,0.0000,0,0.5000,0.2500"));
        // A garbled write leaves the last good level alone.
        inst.set_param("ch4:mix", "nonsense");
        assert_eq!(inst.get_param("ch4:mix").as_deref(), Some("0.3162,0.0000,0,0.5000,0.2500"));
    }

    #[test]
    fn parses_a_send_key() {
        assert_eq!(parse_send_key("snd0:module"), Some((0, "module")));
        assert_eq!(parse_send_key("snd1:fx1:mix"), Some((1, "fx1:mix")),
                   "the remainder keeps its colons");
    }

    #[test]
    fn rejects_send_buses_that_cannot_exist() {
        // Clamping would land a write meant for nothing on bus 0.
        assert_eq!(parse_send_key("snd2:module"), None);
        assert_eq!(parse_send_key("snd9:module"), None);
        assert_eq!(parse_send_key("sndx:module"), None);
        assert_eq!(parse_send_key("snd0"), None);
        assert_eq!(parse_send_key("sound:module"), None);
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

    /* Where a sequenced note goes. This is the assertion that was missing when
     * the chain numbering changed: the UI moved to `ch<N>` = track N and the
     * engine kept subtracting four, so track 4's notes were sequenced into
     * track 0's synth. Every device suite still passed — they inject
     * `ch<N>:midi` directly and never drive a movy track from the sequencer. */
    #[test]
    fn a_tracks_notes_go_to_its_own_chain() {
        // Default: the first four are schwung's, addressed as MIDI channels.
        assert_eq!(chain_for(0, false), None);
        assert_eq!(chain_for(3, false), None);
        // And a movy track's chain is its own index — NOT index minus four.
        assert_eq!(chain_for(4, false), Some(4), "track 4 must not reach chain 0");
        assert_eq!(chain_for(15, false), Some(15));

        // With `chtracks`, all sixteen are chains, still one-to-one.
        for t in 0u8..16 {
            assert_eq!(chain_for(t, true), Some(t as usize));
        }
    }

    /* The flag has to reach the engine, not just the UI. The UI re-points its
     * ports on its own, so a flag the engine never hears looks completely
     * applied right up until a clip plays and the note goes to schwung. */
    #[test]
    fn chtracks_moves_the_first_four_tracks() {
        let mut inst = Instance::new();
        assert_eq!(chain_for(0, inst.movy_tracks), None, "off by default");
        inst.set_param("chtracks", "1");
        assert_eq!(chain_for(0, inst.movy_tracks), Some(0));
        inst.set_param("chtracks", "0");
        assert_eq!(chain_for(0, inst.movy_tracks), None);
    }

    #[test]
    fn parses_a_chain_key() {
        assert_eq!(parse_chain_key("ch0:synth:cutoff"), Some((0, "synth:cutoff")));
        assert_eq!(parse_chain_key("ch11:fx1:wet"), Some((11, "fx1:wet")));
        // Two digits, and the four chains that back tracks 0..3 under
        // `chtracks`. A parser that stopped at one digit would silently address
        // chain 1 for every one of them.
        assert_eq!(parse_chain_key("ch15:synth:cutoff"), Some((15, "synth:cutoff")));
    }

    #[test]
    fn rejects_slots_that_cannot_exist() {
        // Would otherwise index past the slot vector, or silently address the
        // wrong chain.
        let past_the_end = format!("ch{}:synth:cutoff", chain_slots::MOVY_CHAINS);
        assert_eq!(parse_chain_key(&past_the_end), None);
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

    /* The UI holds its loading splash until the chain modules exist, and the
     * queue depth is the only thing that says whether they do. It rides the
     * status poll the UI already makes every few ticks — `diag` carries it too,
     * but reading diag would buy a second blocking get_param per tick for one
     * number. */
    #[test]
    fn status_reports_the_chain_load_backlog() {
        let mut inst = Instance::new();
        let idle = inst.get_param("status").expect("status");
        assert!(idle.contains(" chpend=0"), "an idle engine says so: {idle}");

        inst.chains.request_load(0, "synth", "plaits");
        inst.chains.request_load(1, "synth", "obxd");
        let busy = inst.get_param("status").expect("status");
        assert!(busy.contains(" chpend=2"), "queued loads are reported: {busy}");
    }

    /* The page rides the poll the UI already makes. A dedicated get_param would
     * buy one blocking round trip per repaint for numbers `status` can carry in
     * 250 bytes, and `SHADOW_PARAM_VALUE_LEN` is 65536. */
    #[test]
    fn status_carries_the_cpu_meter_fields() {
        let mut inst = Instance::new();
        let s = inst.get_param("status").expect("status");

        let cost = s
            .split(" chcost=")
            .nth(1)
            .and_then(|r| r.split(' ').next())
            .expect("chcost field");
        assert_eq!(cost.split(',').count(), 16, "one triple per chain: {cost}");
        assert!(cost.split(',').all(|t| t.split('/').count() == 3), "{cost}");
        assert!(cost.starts_with("0/0/0,"), "an idle engine costs nothing: {cost}");

        let wall = s
            .split(" chwall=")
            .nth(1)
            .and_then(|r| r.split(' ').next())
            .expect("chwall field");
        let block: u64 = wall.split('/').nth(2).unwrap().parse().unwrap();
        assert!((2800..3000).contains(&block), "128 frames at 44.1k is ~2902us, got {block}");

        assert!(s.contains(" chmask=0000/0000"), "nothing loaded, nothing asleep: {s}");
    }

    /* `cpurst` must not be `chcostlog`: that one closes the window a device
     * benchmark owns, and the page's peak has to survive a benchmark reading
     * the log while the page is up. */
    #[test]
    fn cpurst_is_accepted_and_does_not_disturb_the_status_shape() {
        let mut inst = Instance::new();
        inst.set_param("cmd", "cpurst");
        let s = inst.get_param("status").expect("status");
        assert!(s.contains(" chcost="), "{s}");
    }
}
