//! Which chains must share a lane, and why.
//!
//! **Modules are assumed thread-safe.** Two chains holding one module through
//! one file share its whole `.data`/`.bss`, and the previous answer was to give
//! every duplicate a private copy of the `.so` — which took MoveOriginal down
//! with `helm` for reasons that were never established
//! (`plans/2026-08-23-per-chain-module-isolation-plan.md` §5). Copying is gone.
//! A duplicate now renders on whatever lane the planner likes.
//!
//! The containment for a module that turns out to race is this **blacklist**:
//! every instance of a listed module goes back on one lane, which is exactly
//! what the planner did to every duplicate before. It ships empty — nothing has
//! been *measured* racing, and seeding it from `audit-render-globals.py` would
//! re-pin most of the fleet and give back the whole point of the change.
//!
//! `pin_all` (`chpin 1`) is the blunt version: pin every duplicate whatever the
//! blacklist says. It is the conservative arm of a measurement and the fallback
//! if a set misbehaves and the culprit is not yet known.
//!
//! Keys are `<namespace>/<module>`, not the synth id, because two chains can
//! share an audio FX while running different synths — airwindows is an FX pack
//! and the module in the fleet most likely to appear twice in one set.

use crate::host;

/// One loaded position in one chain.
struct Comp {
    component: String,
    /// `sound_generators` / `audio_fx` / `midi_fx` — the module's namespace, so
    /// a synth and an FX of the same name are never confused for each other.
    namespace: &'static str,
    module: String,
}

fn namespace_of(component: &str) -> Option<&'static str> {
    if component == "synth" {
        Some("sound_generators")
    } else if component.starts_with("fx") {
        Some("audio_fx")
    } else if component.starts_with("midi") {
        Some("midi_fx")
    } else {
        None
    }
}

pub struct PinPolicy {
    comps: Vec<Vec<Comp>>,
    /// What the planner groups by. Empty means the chain shares nothing that
    /// needs pinning and may render on any lane.
    pin_keys: Vec<String>,
    /// Modules proven to race. Matched on the bare module name across every
    /// namespace: a module that is unsafe as a synth is the same code as an FX.
    blacklist: Vec<String>,
    /// Pin every duplicate, blacklisted or not.
    pin_all: bool,
}

impl PinPolicy {
    pub fn new(chains: usize) -> Self {
        Self {
            comps: (0..chains).map(|_| Vec::new()).collect(),
            pin_keys: vec![String::new(); chains],
            blacklist: Vec::new(),
            pin_all: false,
        }
    }

    /// `chblock <csv>` — the modules that must keep every instance on one lane.
    /// Replaces the list wholesale, so an empty string clears it.
    pub fn set_blacklist(&mut self, csv: &str) {
        let next: Vec<String> = csv
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if next == self.blacklist {
            return;
        }
        self.blacklist = next;
        host::log(&format!("chain pin: blacklist=[{}]", self.blacklist.join(",")));
        self.recompute();
    }

    pub fn blacklist_len(&self) -> usize {
        self.blacklist.len()
    }

    /// Turning this on must change what the PLANNER sees, not merely what the
    /// next load does — otherwise the conservative arm sets the flag, re-keys
    /// nothing, and measures the split plan while reporting the pinned one.
    pub fn set_pin_all(&mut self, on: bool) {
        if on == self.pin_all {
            return;
        }
        self.pin_all = on;
        self.recompute();
    }

    pub fn pin_all(&self) -> bool {
        self.pin_all
    }

    /// Record what a chain now holds. An empty module clears that position.
    pub fn on_load(&mut self, chain: usize, component: &str, module: &str) {
        if chain >= self.comps.len() {
            return;
        }
        let Some(namespace) = namespace_of(component) else { return };
        self.comps[chain].retain(|c| c.component != component);
        if !module.is_empty() {
            self.comps[chain].push(Comp {
                component: component.to_string(),
                namespace,
                module: module.to_string(),
            });
        }
        self.recompute();
    }

    fn blacklisted(&self, module: &str) -> bool {
        self.blacklist.iter().any(|m| m == module)
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
                // Both halves matter. Pinning is only ever about a module held
                // CONCURRENTLY by two chains, so a lone instance of even a
                // blacklisted module runs free — a key there would group it
                // with nothing and cost a lane for no reason.
                if !(self.pin_all || self.blacklisted(&comp.module)) {
                    continue;
                }
                let shared = self.comps.iter().enumerate().any(|(o, list)| {
                    o != c
                        && list
                            .iter()
                            .any(|x| x.namespace == comp.namespace && x.module == comp.module)
                });
                if shared {
                    key = format!("{}/{}", comp.namespace, comp.module);
                    break;
                }
            }
            if self.pin_keys[c] != key {
                self.pin_keys[c] = key;
            }
        }
    }

    /// Per-chain planner grouping key; empty means "run free".
    pub fn pin_keys(&self) -> &[String] {
        &self.pin_keys
    }

    /// Chains currently pinned to something. Reported by `chrenderlog` because
    /// a set with no duplicate plans identically however the flags are set, so
    /// an arm that meant to pin and did not looks exactly like one that did.
    pub fn pinned(&self) -> usize {
        self.pin_keys.iter().filter(|k| !k.is_empty()).count()
    }

    pub fn clear(&mut self) {
        for l in self.comps.iter_mut() {
            l.clear();
        }
        for k in self.pin_keys.iter_mut() {
            k.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(chains: usize) -> PinPolicy {
        PinPolicy::new(chains)
    }

    fn keys(p: &PinPolicy) -> Vec<String> {
        p.pin_keys().to_vec()
    }

    /// The change this revert IS. Twelve chains of one module, nothing
    /// blacklisted: every key empty, so the planner spreads them. Before, all
    /// twelve were pinned and the set returned exactly 1.00x.
    #[test]
    fn duplicates_are_free_by_default() {
        let mut p = policy(12);
        for c in 0..12 {
            p.on_load(c, "synth", "helm");
        }
        assert!(keys(&p).iter().all(|k| k.is_empty()), "{:?}", keys(&p));
        assert_eq!(p.pinned(), 0);
    }

    /// The containment. A blacklisted module puts every instance back together.
    #[test]
    fn a_blacklisted_module_pins_all_its_instances() {
        let mut p = policy(4);
        p.set_blacklist("helm");
        p.on_load(0, "synth", "helm");
        p.on_load(1, "synth", "obxd");
        p.on_load(2, "synth", "helm");
        assert_eq!(keys(&p)[0], "sound_generators/helm");
        assert_eq!(keys(&p)[2], "sound_generators/helm");
        assert_eq!(keys(&p)[1], "", "an unlisted module is not dragged along");
        assert_eq!(p.pinned(), 2);
    }

    /// Pinning is about CONCURRENT holders. One blacklisted chain has nothing to
    /// be kept away from, and a key would cost it a lane of its own for nothing.
    #[test]
    fn a_lone_blacklisted_module_still_runs_free() {
        let mut p = policy(4);
        p.set_blacklist("helm");
        p.on_load(0, "synth", "helm");
        p.on_load(1, "synth", "obxd");
        assert_eq!(keys(&p)[0], "", "one instance shares nothing: {:?}", keys(&p));
    }

    /// `chpin 1` — the blunt arm, for a set that misbehaves before anyone knows
    /// which module is at fault.
    #[test]
    fn pin_all_pins_every_duplicate() {
        let mut p = policy(4);
        p.on_load(0, "synth", "obxd");
        p.on_load(1, "synth", "obxd");
        assert_eq!(keys(&p)[0], "");
        p.set_pin_all(true);
        assert_eq!(keys(&p)[0], "sound_generators/obxd", "{:?}", keys(&p));
        p.set_pin_all(false);
        assert_eq!(keys(&p)[0], "", "and it lets go again");
    }

    /// The key is the namespace too. Two chains sharing an FX must be pinned
    /// even when their synths differ — the synth id alone could never say so.
    #[test]
    fn a_shared_fx_pins_chains_with_different_synths() {
        let mut p = policy(4);
        p.set_blacklist("airwindows");
        p.on_load(0, "synth", "plaits");
        p.on_load(0, "fx1", "airwindows");
        p.on_load(1, "synth", "dexed");
        p.on_load(1, "fx1", "airwindows");
        assert_eq!(keys(&p)[0], "audio_fx/airwindows");
        assert_eq!(keys(&p)[1], "audio_fx/airwindows");
    }

    /// Unloading has to release the partner as well: the chain that stayed is
    /// now the only holder, and a stale key would strand it on a private lane
    /// for the rest of the session.
    #[test]
    fn clearing_a_module_frees_the_chain_that_shared_it() {
        let mut p = policy(4);
        p.set_blacklist("helm");
        p.on_load(0, "synth", "helm");
        p.on_load(1, "synth", "helm");
        assert_eq!(p.pinned(), 2);
        p.on_load(1, "synth", "");
        assert_eq!(p.pinned(), 0, "{:?}", keys(&p));
    }

    #[test]
    fn the_blacklist_is_replaced_wholesale_and_can_be_emptied() {
        let mut p = policy(4);
        p.set_blacklist(" helm , obxd ");
        p.on_load(0, "synth", "obxd");
        p.on_load(1, "synth", "obxd");
        assert_eq!(p.blacklist_len(), 2);
        assert_eq!(keys(&p)[0], "sound_generators/obxd");
        p.set_blacklist("");
        assert_eq!(p.blacklist_len(), 0);
        assert_eq!(keys(&p)[0], "", "clearing the list unpins: {:?}", keys(&p));
    }

    #[test]
    fn teardown_forgets_everything() {
        let mut p = policy(4);
        p.set_blacklist("helm");
        p.on_load(0, "synth", "helm");
        p.on_load(1, "synth", "helm");
        p.clear();
        assert_eq!(p.pinned(), 0);
        // The blacklist is policy, not chain state — it survives a teardown, so
        // a module that races is still contained after the next set loads.
        assert_eq!(p.blacklist_len(), 1);
    }
}
