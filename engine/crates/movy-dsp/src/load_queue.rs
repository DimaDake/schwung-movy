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
    /// Opaque module-preset blob to apply once the module is loaded.
    ///
    /// State CANNOT be written before its module exists — the chain forwards
    /// `synth:state` to the synth, and there is no synth yet. Since loads are
    /// released one per callback, a restore that wrote module and state as two
    /// independent params would always lose the state. Carrying it on the
    /// request makes the ordering structural instead of a timing hope.
    pub state: Option<String>,
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
            /* Only overwrite the blob when the newer request carries one: a
             * restore writes the module and its state as two calls, and the
             * second must not erase what the first attached. */
            if req.state.is_some() {
                existing.state = req.state;
            }
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

    /// Attach a state blob to a pending load, if one is queued for this
    /// slot+component. Returns false when there is nothing pending — the caller
    /// then applies the state directly, because the module is already loaded.
    pub fn attach_state(&mut self, slot: usize, component: &str, state: &str) -> bool {
        match self
            .pending
            .iter_mut()
            .find(|r| r.slot == slot && r.component == component)
        {
            Some(r) => {
                r.state = Some(state.to_string());
                true
            }
            None => false,
        }
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
        LoadRequest {
            slot,
            component: component.to_string(),
            module: module.to_string(),
            state: None,
        }
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
    fn state_attaches_to_a_pending_load() {
        let mut q = LoadQueue::new();
        q.push(req(2, "synth", "plaits"));
        assert!(q.attach_state(2, "synth", "BLOB"), "a pending load accepts state");
        let got = q.take_one().unwrap();
        assert_eq!(got.module, "plaits");
        assert_eq!(got.state.as_deref(), Some("BLOB"),
            "state rides WITH the load so it cannot be applied before the module exists");
    }

    #[test]
    fn state_for_an_unqueued_slot_is_refused() {
        // The caller applies it directly in this case — the module is already
        // loaded, so there is nothing to wait for.
        let mut q = LoadQueue::new();
        assert!(!q.attach_state(2, "synth", "BLOB"));
    }

    #[test]
    fn replacing_a_load_keeps_state_it_did_not_supply() {
        let mut q = LoadQueue::new();
        q.push(req(1, "synth", "plaits"));
        q.attach_state(1, "synth", "BLOB");
        q.push(req(1, "synth", "plaits"));            // no state on this one
        assert_eq!(q.take_one().unwrap().state.as_deref(), Some("BLOB"),
            "a second write of the same module must not erase the attached blob");
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
