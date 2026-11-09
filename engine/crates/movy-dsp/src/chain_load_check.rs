//! Did a chain load actually take?
//!
//! Schwung's chain host answers `synth:module` with nothing: when the module
//! refuses (`create_instance` returns NULL — Amino's static pool holds only
//! four instances, so the fifth track's load fails) it logs and leaves the
//! position EMPTY. movy kept the track as "amino" and the user got a silent
//! track with no reason. The only evidence that survives is the position's
//! read-back, `<component>_module`, so the load path asks it once per load and
//! this records the last refusal for the status line (`lde`).

/// The key that reads back what occupies a component's position, for the
/// components the chain host answers one for (`chain_host.c`: `synth_module`,
/// `fx<N>_module`, `midi_fx<N>_module`). Anything else has no read-back, so it
/// cannot be checked and is never reported.
pub fn readback_key(component: &str) -> Option<String> {
    let indexed = |p: &str| {
        component.strip_prefix(p).is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    };
    (component == "synth" || indexed("fx") || indexed("midi_fx")).then(|| format!("{component}_module"))
}

/// A load refused: something was asked for and the position reads back
/// anything else. A clear (`module` empty) asks for nothing, so it cannot fail.
pub fn refused(module: &str, readback: Option<&str>) -> bool {
    !module.is_empty() && readback != Some(module)
}

/// The last refused load: `lde=<seq>:<slot>:<component>:<module>`. Only the
/// last one rides the status — a Set open that refuses several reports the
/// final one, and the log has all of them.
pub struct LoadErrors {
    seq: u32,
    slot: usize,
    component: String,
    module: String,
}

impl LoadErrors {
    pub fn new() -> Self {
        Self { seq: 0, slot: 0, component: String::new(), module: String::new() }
    }

    pub fn record(&mut self, slot: usize, component: &str, module: &str) {
        self.seq = self.seq.wrapping_add(1);
        self.slot = slot;
        self.component = component.to_string();
        self.module = module.to_string();
    }

    pub fn status(&self) -> String {
        let dash = |s: &str| if s.is_empty() { "-".to_string() } else { s.to_string() };
        format!(" lde={}:{}:{}:{}", self.seq, self.slot, dash(&self.component), dash(&self.module))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readback_keys_cover_only_answered_positions() {
        assert_eq!(readback_key("synth").as_deref(), Some("synth_module"));
        assert_eq!(readback_key("fx1").as_deref(), Some("fx1_module"));
        assert_eq!(readback_key("midi_fx2").as_deref(), Some("midi_fx2_module"));
        assert_eq!(readback_key("fx"), None);
        assert_eq!(readback_key("lfo1"), None);
    }

    #[test]
    fn refused_only_when_a_module_was_asked_for_and_is_not_there() {
        assert!(refused("amino", None));
        assert!(refused("amino", Some("plaits")));
        assert!(!refused("amino", Some("amino")));
        assert!(!refused("", None));
    }

    #[test]
    fn status_counts_and_names_the_last_refusal() {
        let mut e = LoadErrors::new();
        assert_eq!(e.status(), " lde=0:0:-:-");
        e.record(4, "synth", "amino");
        e.record(5, "synth", "amino");
        assert_eq!(e.status(), " lde=2:5:synth:amino");
    }
}
