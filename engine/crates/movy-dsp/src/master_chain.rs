//! The master chain movy owns: four audio FX and two LFOs on one chain host
//! instance, run over the finished output after the send buses, then master
//! volume and a safety limiter.
//!
//! Off unless the UI binds it (`mfx:own=1`, standalone or the `mstown` test
//! flag). Off, it touches nothing, so an overtake build's output is
//! bit-identical to one without it — overtake users still have schwung's master
//! downstream, and running two masters by default would be a change they hear.
//!
//! Design: docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md §5.

use crate::chain_host::ChainInstance;
use crate::send_bus::should_process;

/// Parity with schwung's master chain (design decision 3). The chain host takes
/// eight; a fifth position is one the MASTER page cannot show, so no key and no
/// save may name it.
pub const MASTER_FX: usize = 4;

/// The document component that marks a Set as imported (§5.4). Never loaded:
/// `fx_position` refuses it, and it is the only other component a master entry
/// may carry.
pub const IMPORT_MARK: &str = "imported";

/// −1 dBFS. The limiter guarantees nothing it outputs exceeds this.
const CEILING: f32 = 0.891 * 32767.0;

/// ~50 ms release at Move's 44.1 kHz: 1 - exp(-1 / (0.05 * 44100)).
const RELEASE_COEF: f32 = 4.534e-4;

/// Param writes held while the instance is missing or a master load is still
/// queued. Bounded so a stuck queue cannot grow it without limit; an LFO
/// restore is 22 writes.
const HELD_MAX: usize = 256;

/// `fx1`..`fx4` -> 0..3. Exactly three characters, so `fx01` and `fx10` are
/// refused rather than read as positions.
pub fn fx_position(component: &str) -> Option<usize> {
    if component.len() != 3 {
        return None;
    }
    let n: usize = component.strip_prefix("fx")?.parse().ok()?;
    (1..=MASTER_FX).contains(&n).then(|| n - 1)
}

/// Whether a forwarded `mfx:` key may reach the instance: anything under a
/// component that is not an audio FX position passes (the LFOs), and an FX
/// position must be one of the four.
pub fn key_allowed(rest: &str) -> bool {
    let comp = rest.split(':').next().unwrap_or("");
    if comp.starts_with("fx") {
        return fx_position(comp).is_some();
    }
    !comp.starts_with("midi_fx") && comp != "synth"
}

fn peak(buf: &[i16]) -> i32 {
    buf.iter().fold(0i32, |m, &s| m.max((s as i32).abs()))
}

/// Master volume and the ceiling, as one pass over the block.
///
/// Instant attack, so no sample ever leaves above the ceiling; release rises
/// toward the next sample's own target and never past it, for the same reason.
pub struct Limiter {
    env: f32,
}

impl Limiter {
    pub fn new() -> Self {
        Self { env: 1.0 }
    }

    /// Apply `gain` then the ceiling in place. Returns the deepest gain the
    /// limiter applied this block (1.0 = untouched), for `mfxlog`.
    pub fn process(&mut self, buf: &mut [i16], gain: f32) -> f32 {
        let mut min_env = 1.0f32;
        for frame in buf.chunks_exact_mut(2) {
            let l = frame[0] as f32 * gain;
            let r = frame[1] as f32 * gain;
            let p = l.abs().max(r.abs());
            let target = if p > CEILING { CEILING / p } else { 1.0 };
            if target < self.env {
                self.env = target;
            } else {
                self.env = (self.env + (1.0 - self.env) * RELEASE_COEF).min(target);
            }
            min_env = min_env.min(self.env);
            frame[0] = (l * self.env).round() as i16;
            frame[1] = (r * self.env).round() as i16;
        }
        min_env
    }
}

pub struct MasterChain {
    pub inst: Option<ChainInstance>,
    loaded: [bool; MASTER_FX],
    owned: bool,
    gain: f32,
    imported: bool,
    continuous: bool,
    last_peak: i32,
    limiter: Limiter,
    held: Vec<(String, String)>,
    /* Diagnostics for `mfxlog`: the block's input and output peaks, the
     * limiter's deepest gain, and how many blocks the FX actually ran. Without
     * `processed` an idle-skipped master and a missing one look the same. */
    in_peak: i32,
    out_peak: i32,
    min_env: f32,
    processed: u32,
    /* The CPU page's pair, ns: 1/16 mean and held peak, reset by `cpurst`. */
    ui_ns: u64,
    ui_max_ns: u64,
}

impl MasterChain {
    pub fn new() -> Self {
        Self {
            inst: None,
            loaded: [false; MASTER_FX],
            owned: false,
            gain: 1.0,
            imported: false,
            continuous: false,
            last_peak: 0,
            limiter: Limiter::new(),
            held: Vec::new(),
            in_peak: 0,
            out_peak: 0,
            min_env: 1.0,
            processed: 0,
            ui_ns: 0,
            ui_max_ns: 0,
        }
    }

    pub fn any_loaded(&self) -> bool {
        self.loaded.iter().any(|&l| l)
    }

    pub fn owned(&self) -> bool {
        self.owned
    }

    pub fn set_owned(&mut self, on: bool) {
        self.owned = on;
        /* A stage re-entering the path must not resume a release from minutes
         * ago, nor ring a tail it stopped producing when it left. */
        self.limiter = Limiter::new();
        self.last_peak = 0;
    }

    pub fn gain(&self) -> f32 {
        self.gain
    }

    /// Linear 0..1. A malformed value changes nothing rather than muting.
    pub fn set_gain(&mut self, val: &str) {
        if let Ok(g) = val.trim().parse::<f32>() {
            if g.is_finite() {
                self.gain = g.clamp(0.0, 1.0);
            }
        }
    }

    pub fn imported(&self) -> bool {
        self.imported
    }

    pub fn set_imported(&mut self, on: bool) {
        self.imported = on;
    }

    pub fn note_loaded(&mut self, pos: usize, module: &str) {
        if let Some(l) = self.loaded.get_mut(pos) {
            *l = !module.is_empty();
        }
        if let Some(inst) = self.inst.as_mut() {
            self.continuous = inst.fx_requires_continuous();
        }
    }

    /// Hold a param write until the instance and every queued master load
    /// exist. Same key twice keeps the later value, in the earlier position.
    pub fn hold(&mut self, key: &str, val: &str) {
        if let Some(h) = self.held.iter_mut().find(|(k, _)| k == key) {
            h.1 = val.to_string();
            return;
        }
        if self.held.len() < HELD_MAX {
            self.held.push((key.to_string(), val.to_string()));
        }
    }

    /// Apply held writes in the order they arrived. Called once the last
    /// queued master load has been serviced.
    pub fn flush_held(&mut self) {
        let held = std::mem::take(&mut self.held);
        if let Some(inst) = self.inst.as_mut() {
            for (k, v) in &held {
                inst.set_param(k, v);
            }
        }
    }

    pub fn drop_held(&mut self) {
        self.held.clear();
    }

    /// Forget everything about the instance: the engine is going away.
    pub fn teardown(&mut self) {
        self.inst = None;
        self.loaded = [false; MASTER_FX];
        self.continuous = false;
        self.last_peak = 0;
        self.imported = false;
        self.held.clear();
    }

    /// The stage, over the finished output. `false` when it did nothing (not
    /// owned), so the meter can leave the block out.
    ///
    /// `mod_tick` comes first and runs every block the instance exists, FX
    /// processed or not: an FX-only chain never calls the `render_block` that
    /// normally ticks its LFOs, and a frozen master LFO is silent about it.
    pub fn run(&mut self, out: &mut [i16]) -> bool {
        if !self.owned {
            return false;
        }
        self.in_peak = peak(out);
        let run_fx = self.any_loaded()
            && should_process(self.in_peak > 0, self.last_peak, self.continuous);
        if let Some(inst) = self.inst.as_mut() {
            /* The wake answer is about a synth hearing a MIDI FX's note. This
             * chain has neither. */
            let _ = inst.mod_tick();
            if run_fx {
                inst.process_fx(out);
                self.processed = self.processed.wrapping_add(1);
            }
        }
        /* A skipped block rang nothing, so its tail is over. */
        self.last_peak = if run_fx { peak(out) } else { 0 };
        self.min_env = self.limiter.process(out, self.gain);
        self.out_peak = peak(out);
        true
    }

    pub fn add_cost(&mut self, dt: u64) {
        self.ui_ns = if self.ui_ns == 0 { dt } else { self.ui_ns - self.ui_ns / 16 + dt / 16 };
        self.ui_max_ns = self.ui_max_ns.max(dt);
    }

    pub fn ui_reset(&mut self) {
        self.ui_ns = 0;
        self.ui_max_ns = 0;
    }

    /// `mfxcost=` for the CPU page: `-` when nothing is loaded, the same
    /// "absent vs. costing nothing" split `sndcost` makes.
    pub fn cost_field(&self) -> String {
        if !self.any_loaded() {
            return "-".to_string();
        }
        format!("{}/{}", self.ui_ns / 1000, self.ui_max_ns / 1000)
    }

    /// `mfxlog`. `mods` is the module per position, read by the caller.
    pub fn report(&self, mods: &[String]) -> String {
        format!(
            "own={} vol={:.3} imp={} mod={} in={} out={} gr={:.3} proc={} held={}",
            u8::from(self.owned),
            self.gain,
            u8::from(self.imported),
            mods.iter().map(|m| if m.is_empty() { "-" } else { m.as_str() }).collect::<Vec<_>>().join(","),
            self.in_peak,
            self.out_peak,
            self.min_env,
            self.processed,
            self.held.len()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_are_exactly_fx1_to_fx4() {
        assert_eq!(fx_position("fx1"), Some(0));
        assert_eq!(fx_position("fx4"), Some(3));
        for bad in ["fx0", "fx5", "fx8", "fx01", "fx10", "fx", "synth", "imported", "midi_fx1"] {
            assert_eq!(fx_position(bad), None, "{bad}");
        }
    }

    #[test]
    fn keys_reaching_the_instance_are_the_four_fx_and_the_lfos() {
        assert!(key_allowed("fx1:mix"));
        assert!(key_allowed("fx4:bypassed"));
        assert!(key_allowed("lfo2:depth"));
        assert!(!key_allowed("fx5:mix"), "parity is four positions");
        assert!(!key_allowed("synth:module"), "the master has no synth");
        assert!(!key_allowed("midi_fx1:module"));
    }

    #[test]
    fn unowned_stage_leaves_the_output_bit_identical() {
        let mut m = MasterChain::new();
        m.set_gain("0.5");
        let mut buf: Vec<i16> = (0..256).map(|i| (i * 251 % 65536 - 32768) as i16).collect();
        let before = buf.clone();
        assert!(!m.run(&mut buf));
        assert_eq!(buf, before);
    }

    #[test]
    fn owned_at_unity_below_the_ceiling_is_untouched() {
        let mut m = MasterChain::new();
        m.set_owned(true);
        let mut buf: Vec<i16> = (0..256).map(|i| ((i % 64) * 400 - 12800) as i16).collect();
        let before = buf.clone();
        assert!(m.run(&mut buf));
        assert_eq!(buf, before);
    }

    #[test]
    fn volume_scales() {
        let mut m = MasterChain::new();
        m.set_owned(true);
        m.set_gain("0.5");
        let mut buf = vec![10000i16; 256];
        m.run(&mut buf);
        assert!(buf.iter().all(|&s| s == 5000));
    }

    #[test]
    fn gain_is_clamped_and_garbage_is_ignored() {
        let mut m = MasterChain::new();
        m.set_gain("2");
        assert_eq!(m.gain(), 1.0);
        m.set_gain("-1");
        assert_eq!(m.gain(), 0.0);
        m.set_gain("0.25");
        m.set_gain("nan");
        m.set_gain("x");
        assert_eq!(m.gain(), 0.25);
    }

    #[test]
    fn limiter_never_exceeds_the_ceiling_and_releases() {
        let mut lim = Limiter::new();
        let mut hot = vec![32767i16; 256];
        let gr = lim.process(&mut hot, 1.0);
        assert!(gr < 1.0);
        assert!(hot.iter().all(|&s| (s as f32) <= CEILING + 0.5), "{:?}", &hot[..4]);
        /* Quiet signal afterwards: the gain climbs back toward unity but has
         * not jumped there — a release, not a switch. */
        let mut quiet = vec![1000i16; 256];
        lim.process(&mut quiet, 1.0);
        assert!(quiet[0] < 1000 && quiet[255] > quiet[0], "{} {}", quiet[0], quiet[255]);
        let mut later = vec![1000i16; 2];
        for _ in 0..1000 {
            later = vec![1000i16; 256];
            lim.process(&mut later, 1.0);
        }
        assert_eq!(later[255], 1000, "fully released after ~3 s");
    }

    #[test]
    fn held_writes_keep_order_and_the_last_value() {
        let mut m = MasterChain::new();
        m.hold("lfo1:target", "fx1");
        m.hold("lfo1:depth", "0.2");
        m.hold("lfo1:target", "fx2");
        assert_eq!(m.held, vec![("lfo1:target".into(), "fx2".into()), ("lfo1:depth".into(), "0.2".into())]);
        m.flush_held();
        assert!(m.held.is_empty(), "flushed even with no instance: nothing could take them later");
    }

    #[test]
    fn cost_field_says_absent_when_nothing_is_loaded() {
        let mut m = MasterChain::new();
        assert_eq!(m.cost_field(), "-");
        m.note_loaded(2, "freeverb");
        m.add_cost(4000);
        assert_eq!(m.cost_field(), "4/4");
        m.note_loaded(2, "");
        assert_eq!(m.cost_field(), "-");
    }
}
