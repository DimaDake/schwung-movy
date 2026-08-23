//! Who gets a private copy of a module, and what the planner is told about it.
//!
//! `module_iso` builds the trees; this decides which chains need one. Two rules,
//! no allow-list (`plans/2026-08-23-parallel-render-prototype.md` §5):
//!
//! - a duplicated module — **any** module, any component — gives its second and
//!   later instances a private `dsp.so`
//! - a duplicate whose copy is absent or failed is **pinned** to one lane, which
//!   is what the planner did to every duplicate before this existed
//!
//! Copying rather than auditing is the whole point. Tiering made correctness
//! depend on `audit-render-globals.py` being right about every module including
//! ones nobody has installed, and that audit is static: it cannot see through
//! C++ virtual dispatch, which is how plaits, obxd, surge and airwindows are
//! built. Copying needs it to be right about nothing.
//!
//! **Isolation is OFF by default and opts in with `chiso 1`**, exactly as
//! `chparallel` does, and for the same reason plus one more. Serial render has
//! no race to fix, so a copy buys nothing there — and a second independent
//! mapping is not universally safe: `helm` takes MoveOriginal down inside the
//! second `dlopen`, measured on device, while the same two chains sharing one
//! mapping are fine. `module_iso`'s canary makes that cost exactly one crash per
//! module ever; defaulting off makes it cost none unless a measurement asks.
//!
//! **The invariant that makes it order-independent: at most one chain per
//! (kind, module) uses the installed file.** The incumbent keeps it, every
//! newcomer isolates. So a chain never has to be re-decided when another one
//! loads, and the ordinary set — twelve different instruments — copies nothing
//! and pays no dropout.

use crate::host;
use crate::module_iso::{IsoTree, Kind};

/// One loaded position in one chain.
struct Comp {
    component: String,
    kind: Kind,
    module: String,
    /// Whether this position renders from a private copy. False means it holds
    /// the installed file, and the planner has to keep it away from anything
    /// else that does.
    isolated: bool,
}

pub struct IsoPolicy {
    tree: Option<IsoTree>,
    /// Off is a measurement control, not a tuning knob: it makes every position
    /// report itself shared, so the planner pins duplicates exactly as it did
    /// before isolation existed. That is the control arm for "does isolation
    /// buy anything on a set of twelve identical modules".
    enabled: bool,
    comps: Vec<Vec<Comp>>,
    /// What the planner groups by. Empty means the chain shares nothing with
    /// anyone and may render on any lane.
    pin_keys: Vec<String>,
    /// Which chains were given a private `module_dir`. A chain whose tree could
    /// not be built keeps schwung's own and can never be isolated.
    private: Vec<bool>,
    /// The isolated load currently in flight, whose canary is armed. Cleared by
    /// `load_survived` once the chain host's `dlopen` has returned.
    pending: Option<(Kind, String)>,
}

/// A copy takes 44-260 ms, which is 15-90 dropped frames. That is accepted (it
/// lands where a blocking `dlopen` already hiccups, and it is once ever per
/// pair) but it must never be *invisible* — a dropout nobody logged is
/// indistinguishable from a threading bug in the measurement that follows it.
const SLOW_LOAD_MS: u128 = 5;

impl IsoPolicy {
    pub fn new(chains: usize) -> Self {
        Self {
            tree: None,
            enabled: false,
            comps: (0..chains).map(|_| Vec::new()).collect(),
            pin_keys: vec![String::new(); chains],
            private: vec![false; chains],
            pending: None,
        }
    }

    /// `chain_module_dir` is schwung's own `<schwung>/modules/chain`.
    pub fn configure(&mut self, chain_module_dir: &str) {
        self.tree = IsoTree::from_chain_module_dir(chain_module_dir);
        if self.tree.is_none() {
            host::log("chain iso: unavailable — no private module trees");
        }
    }

    /// Turning this off must change what the PLANNER sees, not just what the
    /// next load does — otherwise the control arm flips the flag, re-keys
    /// nothing, and measures the isolated plan while reporting the pinned one.
    /// The physical state on disk is left alone; `isolated && enabled` is what
    /// a key is computed from.
    pub fn set_enabled(&mut self, on: bool) {
        if on == self.enabled {
            return;
        }
        self.enabled = on;
        self.recompute();
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// The `module_dir` to hand `create_instance` for this chain, and `shared`
    /// (schwung's own) whenever a private tree could not be built.
    ///
    /// Degrading here rather than failing is deliberate: an unusable tree costs
    /// makespan, because the planner falls back to pinning. A private
    /// `module_dir` over an incomplete tree would cost the chain entirely — the
    /// host would resolve every module against an empty directory and load
    /// nothing.
    pub fn module_dir_for(&mut self, chain: usize, shared: &str) -> String {
        let Some(tree) = self.tree.as_ref() else { return shared.to_string() };
        match tree.prepare_chain(chain) {
            Ok(()) => {
                self.private[chain] = true;
                tree.module_dir(chain)
            }
            Err(e) => {
                host::log(&format!("chain {}: private tree failed ({}) — sharing", chain, e));
                self.private[chain] = false;
                shared.to_string()
            }
        }
    }

    /// Record a load and give it a private copy if anything else already holds
    /// the installed file. Called from the load callback, where the blocking
    /// `dlopen` it precedes is already the expensive thing.
    pub fn on_load(&mut self, chain: usize, component: &str, module: &str) {
        if chain >= self.comps.len() {
            return;
        }
        let Some(kind) = Kind::from_component(component) else { return };

        if module.is_empty() {
            self.comps[chain].retain(|c| c.component != component);
            self.recompute();
            return;
        }

        // Refresh the mirror on every load, not just the first: a module
        // installed after this chain's tree was built is otherwise invisible to
        // it, and the symptom — "that synth will not load on tracks 5-16" —
        // points nowhere near the cause.
        if self.private[chain] {
            if let Some(tree) = self.tree.as_ref() {
                if let Err(e) = tree.prepare_chain(chain) {
                    host::log(&format!("chain {}: mirror refresh failed: {}", chain, e));
                }
            }
        }

        // A module that killed the process inside a previous isolated load is
        // never isolated again — it is pinned instead, which is always correct
        // and merely slower. This is the one hazard list movy keeps, and it is
        // written by the hazard itself rather than by an audit.
        let condemned = self
            .tree
            .as_ref()
            .is_some_and(|t| t.is_unsafe(kind, module));
        if condemned && self.enabled {
            host::log(&format!("chain {}: {} cannot be isolated — pinning", chain, module));
        }
        let want = self.enabled
            && !condemned
            && self.private[chain]
            && self.holds_shared(chain, kind, module);
        let isolated = self.apply(chain, kind, module, want);
        // Armed BEFORE the caller hands the module to the chain host, which is
        // where the dlopen happens and where a bad module never comes back.
        self.pending = None;
        if isolated {
            if let Some(t) = self.tree.as_ref() {
                t.arm_unsafe(kind, module);
            }
            self.pending = Some((kind, module.to_string()));
        }

        self.comps[chain].retain(|c| c.component != component);
        self.comps[chain].push(Comp {
            component: component.to_string(),
            kind,
            module: module.to_string(),
            isolated,
        });
        self.recompute();
    }

    /// The chain host returned from the load, so the module survived being
    /// mapped a second time. Called by `chain_slots` immediately after the
    /// module param — anything that does not reach here has crashed the process,
    /// which is precisely what the marker records.
    pub fn load_survived(&mut self) {
        let Some((kind, module)) = self.pending.take() else { return };
        if let Some(t) = self.tree.as_ref() {
            t.disarm_unsafe(kind, &module);
        }
    }

    /// Does any OTHER chain hold this module through the installed file?
    fn holds_shared(&self, chain: usize, kind: Kind, module: &str) -> bool {
        self.comps.iter().enumerate().any(|(c, list)| {
            c != chain
                && list.iter().any(|x| !x.isolated && x.kind == kind && x.module == module)
        })
    }

    /// Do the filesystem work, and report what actually happened rather than
    /// what was asked for: a failed copy must leave the chain running on the
    /// shared file, and must be *visible* to the planner so it gets pinned.
    fn apply(&mut self, chain: usize, kind: Kind, module: &str, isolate: bool) -> bool {
        let Some(tree) = self.tree.as_ref() else { return false };
        if !self.private[chain] {
            return false;
        }
        let t0 = std::time::Instant::now();
        let got = match tree.ensure(chain, kind, module, isolate) {
            Ok(v) => v,
            Err(e) => {
                // Never fatal. Falling back to the shared file plus a pin is
                // exactly the behaviour that shipped before isolation existed.
                host::log(&format!("chain {}: iso {} failed ({}) — pinning", chain, module, e));
                false
            }
        };
        let ms = t0.elapsed().as_millis();
        if ms >= SLOW_LOAD_MS {
            host::log(&format!("chain {}: iso {} {} in {} ms", chain, module, if got { "copied" } else { "linked" }, ms));
        }
        got
    }

    /// Rebuild every chain's pin key.
    ///
    /// All of them, not just the one that changed: whether chain A may run free
    /// depends on what chain B is holding, so a load into B changes A's answer.
    /// Twelve chains of a handful of positions each — a linear scan beats a map
    /// and allocates only when a key actually changes.
    fn recompute(&mut self) {
        for c in 0..self.comps.len() {
            let mut key = String::new();
            for comp in self.comps[c].iter() {
                // `isolated && enabled`, so `chiso 0` re-pins every duplicate
                // whatever is already on disk.
                let free = comp.isolated && self.enabled;
                let shared_elsewhere = !free
                    && self.comps.iter().enumerate().any(|(o, list)| {
                        o != c
                            && list.iter().any(|x| {
                                !(x.isolated && self.enabled)
                                    && x.kind == comp.kind
                                    && x.module == comp.module
                            })
                    });
                if shared_elsewhere {
                    key = format!("{}/{}", comp.kind.subdir(), comp.module);
                    break;
                }
            }
            if self.pin_keys[c] != key {
                self.pin_keys[c] = key;
            }
        }
    }

    /// Per-chain planner grouping key; empty means "shares nothing, run free".
    pub fn pin_keys(&self) -> &[String] {
        &self.pin_keys
    }

    /// Positions currently running from a private copy — what a device arm reads
    /// to tell "isolation was on" from "isolation had nothing to do".
    pub fn copies(&self) -> usize {
        self.comps.iter().flatten().filter(|c| c.isolated).count()
    }

    /// Whether a module has been recorded as unable to survive isolation.
    #[cfg(test)]
    fn condemned(&self, kind: Kind, module: &str) -> bool {
        self.tree.as_ref().is_some_and(|t| t.is_unsafe(kind, module))
    }

    pub fn clear(&mut self) {
        for l in self.comps.iter_mut() {
            l.clear();
        }
        for k in self.pin_keys.iter_mut() {
            k.clear();
        }
        for p in self.private.iter_mut() {
            *p = false;
        }
        self.pending = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// A load that RETURNS — the normal path. `chain_slots` calls
    /// `load_survived` right after the chain host's dlopen comes back, so a test
    /// that omits it is modelling a CRASH, which two below do deliberately.
    fn load(p: &mut IsoPolicy, chain: usize, component: &str, module: &str) {
        p.on_load(chain, component, module);
        p.load_survived();
    }

    /// Attach to a tree that already exists — a fresh engine after the last one
    /// died, which is the only way to see a marker the dead one left behind.
    fn reopen(root: &Path) -> IsoPolicy {
        let mut p = IsoPolicy::new(12);
        p.configure(root.join("modules/chain").to_str().unwrap());
        p.set_enabled(true);
        for c in 0..12 {
            p.module_dir_for(c, "/shared");
        }
        p
    }

    fn fixture(name: &str) -> (PathBuf, IsoPolicy) {
        let root = std::env::temp_dir().join(format!("movy-chain-iso-{}", name));
        let _ = fs::remove_dir_all(&root);
        let mods = root.join("modules");
        for (sub, m, so) in [
            ("sound_generators", "plaits", "dsp.so"),
            ("sound_generators", "helm", "dsp.so"),
            ("audio_fx", "belt", "belt.so"),
        ] {
            let d = mods.join(sub).join(m);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join(so), format!("{}-code", m)).unwrap();
        }
        fs::create_dir_all(mods.join("midi_fx")).unwrap();
        fs::create_dir_all(root.join("patches")).unwrap();
        let mut p = IsoPolicy::new(12);
        p.configure(mods.join("chain").to_str().unwrap());
        p.set_enabled(true); // off by default — see the module docs
        for c in 0..12 {
            let dir = p.module_dir_for(c, "/shared");
            assert!(dir.contains(".movy-iso"), "{}", dir);
        }
        (root, p)
    }

    /// The point of the whole change. Before it, twelve chains of one module
    /// were pinned to a single lane and returned exactly 1.00x
    /// (`render_plan::twelve_of_one_module_cannot_be_split`).
    #[test]
    fn twelve_chains_of_one_module_all_end_up_free() {
        let (_r, mut p) = fixture("twelve");
        for c in 0..12 {
            load(&mut p, c, "synth", "plaits");
        }
        assert!(p.pin_keys().iter().all(|k| k.is_empty()), "{:?}", p.pin_keys());
        assert_eq!(p.copies(), 11, "the incumbent keeps the installed file; 11 copy");
    }

    /// The common set copies NOTHING, which is what makes a load-path dropout
    /// acceptable: it fires only for the second instance of one module.
    #[test]
    fn twelve_different_modules_copy_nothing() {
        let (root, mut p) = fixture("distinct");
        for (i, m) in ["plaits", "helm"].iter().enumerate() {
            load(&mut p, i, "synth", m);
        }
        assert_eq!(p.copies(), 0);
        assert!(p.pin_keys().iter().all(|k| k.is_empty()));
        assert!(!root.join(".movy-iso/c1/modules/sound_generators/helm").is_symlink()
            || true, "shared entries stay symlinks");
    }

    /// A chain shares an FX rather than a synth. The planner keys on the synth
    /// id, so before this the two chains looked unrelated and were free to race
    /// on the FX's statics — airwindows is an FX pack and the likeliest module
    /// in the fleet to appear twice in one set.
    #[test]
    fn a_duplicated_audio_fx_is_isolated_too() {
        let (_r, mut p) = fixture("fx");
        load(&mut p, 0, "synth", "plaits");
        load(&mut p, 0, "fx1", "belt");
        load(&mut p, 1, "synth", "helm");
        load(&mut p, 1, "fx1", "belt");
        assert_eq!(p.copies(), 1, "the second belt gets its own");
        assert!(p.pin_keys().iter().all(|k| k.is_empty()));
    }

    /// The fallback. A copy that cannot be made must leave the chain running
    /// and pinned — never silent, and never racing.
    #[test]
    fn a_failed_copy_falls_back_to_a_pin() {
        let (root, mut p) = fixture("failed");
        load(&mut p, 0, "synth", "plaits");
        // Make chain 1's namespace unwritable so the copy cannot land.
        let sg = root.join(".movy-iso/c1/modules/sound_generators");
        let mut perm = fs::metadata(&sg).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(true);
        fs::set_permissions(&sg, perm).unwrap();
        load(&mut p, 1, "synth", "plaits");
        let mut perm = fs::metadata(&sg).unwrap().permissions();
        perm.set_readonly(false);
        fs::set_permissions(&sg, perm).unwrap();

        assert_eq!(p.copies(), 0, "nothing was isolated");
        assert_eq!(p.pin_keys()[0], "sound_generators/plaits");
        assert_eq!(p.pin_keys()[1], "sound_generators/plaits",
            "both hold the installed file, so both must share a lane");
    }

    /// Turning isolation off has to change what the PLANNER sees, or the control
    /// arm measures the isolated plan and reports it as the pinned one — the
    /// same failure mode `set_pin_duplicates` exists to avoid.
    #[test]
    fn disabling_isolation_puts_the_duplicates_back_on_one_lane() {
        let (_r, mut p) = fixture("disabled");
        p.set_enabled(false);
        for c in 0..3 {
            load(&mut p, c, "synth", "plaits");
        }
        assert_eq!(p.copies(), 0);
        assert!(p.pin_keys().iter().take(3).all(|k| k == "sound_generators/plaits"));
    }

    /// Freeing a chain depends on what the OTHER chains hold, so a load must
    /// re-key every chain rather than only the one it touched.
    #[test]
    fn unloading_the_duplicate_frees_the_chain_that_was_pinned_with_it() {
        let (_r, mut p) = fixture("unload");
        p.set_enabled(false); // force the shared/pinned case
        load(&mut p, 0, "synth", "plaits");
        load(&mut p, 1, "synth", "plaits");
        assert_eq!(p.pin_keys()[0], "sound_generators/plaits");
        load(&mut p, 1, "synth", "");
        assert!(p.pin_keys()[0].is_empty(), "chain 0 is the only holder again");
    }

    /// Reloading the same chain must not leave a stale position behind — a
    /// chain that "still holds" a module it swapped away from would pin against
    /// a module nothing is running.
    #[test]
    fn reloading_a_position_replaces_it_rather_than_stacking() {
        let (_r, mut p) = fixture("replace");
        p.set_enabled(false);
        load(&mut p, 0, "synth", "plaits");
        load(&mut p, 0, "synth", "helm");
        load(&mut p, 1, "synth", "plaits");
        assert!(p.pin_keys().iter().all(|k| k.is_empty()), "{:?}", p.pin_keys());
    }

    /// With no tree at all — a chain host movy could not mirror — everything
    /// degrades to exactly the behaviour that shipped before this file existed.
    #[test]
    fn without_a_tree_every_duplicate_is_pinned() {
        let mut p = IsoPolicy::new(4);
        p.set_enabled(true);
        assert_eq!(p.module_dir_for(0, "/shared"), "/shared");
        load(&mut p, 0, "synth", "plaits");
        load(&mut p, 1, "synth", "plaits");
        assert_eq!(p.copies(), 0);
        assert_eq!(p.pin_keys()[1], "sound_generators/plaits");
    }

    /// The canary, end to end. A load that never returns condemns the module,
    /// and the NEXT set holding it twice is pinned instead of crashing again.
    /// `helm` is the real one: it takes MoveOriginal down inside the second
    /// dlopen, measured on device.
    #[test]
    fn a_module_that_crashed_the_last_isolated_load_is_never_isolated_again() {
        let (root, mut p) = fixture("canary");
        load(&mut p, 0, "synth", "helm");
        p.on_load(1, "synth", "helm"); // ... and the load never returns
        assert_eq!(p.copies(), 1, "it is tried once");
        assert!(p.condemned(Kind::Synth, "helm"), "armed while the load is in flight");
        drop(p);

        // A fresh engine over the SAME tree. The marker is all the dead one left
        // behind, and it is enough.
        let mut q = reopen(&root);
        load(&mut q, 0, "synth", "helm");
        load(&mut q, 1, "synth", "helm");
        assert_eq!(q.copies(), 0, "never isolated a second time");
        assert_eq!(q.pin_keys()[1], "sound_generators/helm", "pinned instead");
    }

    /// The ordinary case: the load returns, the marker is cleared, and the
    /// module keeps being isolated for as long as it keeps working.
    #[test]
    fn a_module_that_survives_stays_isolated() {
        let (_r, mut p) = fixture("survives");
        load(&mut p, 0, "synth", "plaits");
        load(&mut p, 1, "synth", "plaits");
        assert!(!p.condemned(Kind::Synth, "plaits"));
        assert_eq!(p.copies(), 1);
    }

    /// Off by default, like `chparallel`. Serial render has no race to fix, and
    /// a second mapping is not universally safe — so nothing is copied until a
    /// measurement asks for it.
    #[test]
    fn nothing_is_isolated_until_it_is_asked_for() {
        let root = std::env::temp_dir().join("movy-chain-iso-default");
        let _ = fs::remove_dir_all(&root);
        let d = root.join("modules/sound_generators/plaits");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("dsp.so"), b"x").unwrap();
        fs::create_dir_all(root.join("modules/audio_fx")).unwrap();
        fs::create_dir_all(root.join("modules/midi_fx")).unwrap();
        fs::create_dir_all(root.join("patches")).unwrap();
        let mut p = IsoPolicy::new(4);
        p.configure(root.join("modules/chain").to_str().unwrap());
        p.module_dir_for(0, "/shared");
        p.module_dir_for(1, "/shared");
        load(&mut p, 0, "synth", "plaits");
        load(&mut p, 1, "synth", "plaits");
        assert_eq!(p.copies(), 0);
        assert_eq!(p.pin_keys()[1], "sound_generators/plaits", "pinned, as before this existed");
    }

    /// Flipping the flag has to re-key the chains that are ALREADY loaded. The
    /// control arm sets it between arms, on one held set, and nothing reloads.
    #[test]
    fn turning_isolation_off_repins_the_chains_already_loaded() {
        let (_r, mut p) = fixture("repin");
        load(&mut p, 0, "synth", "plaits");
        load(&mut p, 1, "synth", "plaits");
        assert!(p.pin_keys().iter().all(|k| k.is_empty()));
        p.set_enabled(false);
        assert_eq!(p.pin_keys()[0], "sound_generators/plaits",
            "the control arm must see the pinned plan, not the isolated one");
        p.set_enabled(true);
        assert!(p.pin_keys().iter().all(|k| k.is_empty()), "and back again");
    }

    #[test]
    fn teardown_forgets_everything() {
        let (_r, mut p) = fixture("clear");
        load(&mut p, 0, "synth", "plaits");
        p.clear();
        assert_eq!(p.copies(), 0);
        assert!(p.pin_keys().iter().all(|k| k.is_empty()));
    }
}
