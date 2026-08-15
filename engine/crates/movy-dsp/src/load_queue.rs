//! Serialising module loads so a burst cannot stack inside one audio callback.
//!
//! schwung handles `synth:module` — which dlopens a synth and reads its JSON —
//! inside `shim_pre_transfer`, the SPI callback. Measured on device
//! (`scripts/measure-load-blocking.sh`): the param handler sits at 81us idle and
//! peaks at 1986us during a load, against a ~900us section budget inside a
//! 2900us frame. The platform overruns on every module load and tolerates it.
//!
//! movy hosts up to 12 chains, so restoring a set could ask for 12 loads at
//! once. One overrun is what schwung already does; twelve in a single callback
//! is roughly 24ms of blocked audio and is movy's own invention. This queue
//! keeps the platform's model (loads still happen on the audio thread, no
//! locking, no worker) and bounds only the part that is worse: **at most one
//! load is released per callback.**
//!
//! It deliberately does NOT make loading cheap. A load still overruns. If that
//! ever proves unacceptable the answer is to move loads off the audio thread
//! entirely, which needs a handshake around chain state that has no locking —
//! a much larger change than this file.

/// A pending "load this module into this chain slot" request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadRequest {
    pub slot: usize,
    /// Component within the chain: "synth", "fx1", "fx2", "midi_fx1".
    pub component: String,
    /// Module id, or empty to unload.
    pub module: String,
}

#[derive(Debug, Default)]
pub struct LoadQueue {
    pending: Vec<LoadRequest>,
}

impl LoadQueue {
    pub fn new() -> Self {
        Self { pending: Vec::new() }
    }

    /// Queue a load. A later request for the same slot+component REPLACES the
    /// earlier one: loading two modules into one slot back-to-back means the
    /// first was never wanted, and doing it anyway would spend an overrun on a
    /// module that is about to be thrown away.
    pub fn push(&mut self, req: LoadRequest) {
        if let Some(existing) = self
            .pending
            .iter_mut()
            .find(|r| r.slot == req.slot && r.component == req.component)
        {
            existing.module = req.module;
            return;
        }
        self.pending.push(req);
    }

    /// Take at most one request. Called once per audio callback — this single
    /// return value is the whole serialisation guarantee.
    pub fn take_one(&mut self) -> Option<LoadRequest> {
        if self.pending.is_empty() {
            return None;
        }
        Some(self.pending.remove(0))
    }

    pub fn len(&self) -> usize {
        self.pending.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// Drop everything queued. Used when the engine is torn down: a pending load
    /// refers to slots that are about to stop existing.
    pub fn clear(&mut self) {
        self.pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(slot: usize, component: &str, module: &str) -> LoadRequest {
        LoadRequest { slot, component: component.to_string(), module: module.to_string() }
    }

    #[test]
    fn releases_at_most_one_per_callback() {
        let mut q = LoadQueue::new();
        for slot in 0..12 {
            q.push(req(slot, "synth", "plaits"));
        }
        assert_eq!(q.len(), 12);

        // The point of the whole file: a 12-chain restore takes 12 callbacks,
        // not one callback doing 12 blocking dlopens.
        for expected_slot in 0..12 {
            let got = q.take_one().expect("a request should be released");
            assert_eq!(got.slot, expected_slot, "requests are released in order");
            assert_eq!(q.len(), 11 - expected_slot);
        }
        assert!(q.take_one().is_none(), "queue drains to empty");
    }

    #[test]
    fn later_request_replaces_earlier_for_same_component() {
        let mut q = LoadQueue::new();
        q.push(req(3, "synth", "plaits"));
        q.push(req(3, "synth", "obxd"));
        assert_eq!(q.len(), 1, "one slot+component holds one pending load");
        assert_eq!(q.take_one().unwrap().module, "obxd", "the latest wins");
    }

    #[test]
    fn different_components_on_one_slot_are_separate() {
        let mut q = LoadQueue::new();
        q.push(req(2, "synth", "plaits"));
        q.push(req(2, "fx1", "reverb"));
        assert_eq!(q.len(), 2, "a chain's synth and FX load independently");
    }

    #[test]
    fn replacing_keeps_the_original_queue_position() {
        // Otherwise a slot whose module keeps changing could starve the others.
        let mut q = LoadQueue::new();
        q.push(req(0, "synth", "a"));
        q.push(req(1, "synth", "b"));
        q.push(req(0, "synth", "c"));
        assert_eq!(q.take_one().unwrap().slot, 0);
        assert_eq!(q.take_one().unwrap().slot, 1);
    }

    #[test]
    fn empty_module_is_a_valid_unload_request() {
        let mut q = LoadQueue::new();
        q.push(req(5, "synth", ""));
        let got = q.take_one().unwrap();
        assert_eq!(got.module, "", "unloading is queued like any other load");
    }

    #[test]
    fn clear_drops_everything() {
        let mut q = LoadQueue::new();
        q.push(req(0, "synth", "plaits"));
        q.push(req(1, "synth", "plaits"));
        q.clear();
        assert!(q.is_empty());
        assert!(q.take_one().is_none());
    }
}
