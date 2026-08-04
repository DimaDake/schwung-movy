//! Undo snapshot ring.
//!
//! The UI owns the undo *stack*; this owns the *state* each entry refers to.
//! Entries address a snapshot by integer id, so the serialized state never
//! crosses IPC — the UI sends `usnap 7` / `uswap 7 8`, never kilobytes through
//! the single-slot param SHM.
//!
//! Two caps, because a set with dense clips serializes to several KB and the
//! DSP lives inside MoveOriginal: an entry count and a byte budget, whichever
//! binds first. Eviction is from the front (oldest), matching the UI stack's
//! own eviction so the two stay in step.

/// Newest-first eviction bound. Mirrors `MAX_ENTRIES` in `src/undo/state.ts`.
pub const MAX_SNAPSHOTS: usize = 64;
/// Total serialized bytes held across all snapshots.
pub const MAX_BYTES: usize = 512 * 1024;

pub struct UndoRing {
    /// Insertion-ordered; the front is the oldest and is evicted first.
    slots: Vec<(u32, String)>,
    bytes: usize,
    /// Set by `note_noop`, drained once by `status`. The UI pushes entries
    /// optimistically and retracts on this id when the engine found nothing
    /// actually changed.
    noop: Option<u32>,
}

impl Default for UndoRing {
    fn default() -> Self {
        Self::new()
    }
}

impl UndoRing {
    pub fn new() -> Self {
        UndoRing {
            slots: Vec::new(),
            bytes: 0,
            noop: None,
        }
    }

    pub fn snap(&mut self, id: u32, payload: String) {
        self.drop_id(id);
        self.bytes += payload.len();
        self.slots.push((id, payload));
        self.evict();
    }

    pub fn peek(&self, id: u32) -> Option<&str> {
        self.slots
            .iter()
            .find(|(i, _)| *i == id)
            .map(|(_, p)| p.as_str())
    }

    /// Remove and return a snapshot. `uswap` takes the payload out before
    /// restoring, so the borrow of the ring ends before the Engine is mutated.
    pub fn take(&mut self, id: u32) -> Option<String> {
        let idx = self.slots.iter().position(|(i, _)| *i == id)?;
        let (_, payload) = self.slots.remove(idx);
        self.bytes -= payload.len();
        Some(payload)
    }

    pub fn drop_id(&mut self, id: u32) {
        if let Some(idx) = self.slots.iter().position(|(i, _)| *i == id) {
            self.bytes -= self.slots[idx].1.len();
            self.slots.remove(idx);
        }
    }

    pub fn clear(&mut self) {
        self.slots.clear();
        self.bytes = 0;
        self.noop = None;
    }

    pub fn note_noop(&mut self, id: u32) {
        self.noop = Some(id);
    }

    pub fn take_noop(&mut self) -> Option<u32> {
        self.noop.take()
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    fn evict(&mut self) {
        while self.slots.len() > MAX_SNAPSHOTS
            || (self.bytes > MAX_BYTES && self.slots.len() > 1)
        {
            let (_, payload) = self.slots.remove(0);
            self.bytes -= payload.len();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_then_peek_returns_payload() {
        let mut r = UndoRing::new();
        r.snap(1, "movy1\nbpm 12000\n".into());
        assert_eq!(r.peek(1), Some("movy1\nbpm 12000\n"));
        assert_eq!(r.peek(2), None);
    }

    #[test]
    fn take_removes_and_returns() {
        let mut r = UndoRing::new();
        r.snap(1, "abc".into());
        assert_eq!(r.take(1).as_deref(), Some("abc"));
        assert_eq!(r.peek(1), None);
        assert_eq!(r.bytes(), 0);
        assert_eq!(r.take(1), None);
    }

    #[test]
    fn drop_id_frees() {
        let mut r = UndoRing::new();
        r.snap(1, "abcd".into());
        r.snap(2, "ef".into());
        r.drop_id(1);
        assert_eq!(r.len(), 1);
        assert_eq!(r.bytes(), 2);
        assert_eq!(r.peek(1), None);
    }

    #[test]
    fn snapping_the_same_id_replaces_it() {
        let mut r = UndoRing::new();
        r.snap(1, "aaaa".into());
        r.snap(1, "bb".into());
        assert_eq!(r.len(), 1);
        assert_eq!(r.bytes(), 2);
        assert_eq!(r.peek(1), Some("bb"));
    }

    #[test]
    fn evicts_oldest_past_max_snapshots() {
        let mut r = UndoRing::new();
        for i in 0..(MAX_SNAPSHOTS as u32 + 5) {
            r.snap(i, "x".into());
        }
        assert_eq!(r.len(), MAX_SNAPSHOTS);
        // The first five ids are gone; the newest survives.
        assert_eq!(r.peek(0), None);
        assert_eq!(r.peek(4), None);
        assert!(r.peek(5).is_some());
        assert!(r.peek(MAX_SNAPSHOTS as u32 + 4).is_some());
    }

    #[test]
    fn evicts_oldest_past_max_bytes() {
        let mut r = UndoRing::new();
        let big = "y".repeat(MAX_BYTES / 4);
        for i in 0..6 {
            r.snap(i, big.clone());
        }
        assert!(r.bytes() <= MAX_BYTES, "bytes={} over budget", r.bytes());
        assert!(r.peek(0).is_none(), "oldest should have been evicted");
        assert!(r.peek(5).is_some(), "newest must survive");
    }

    /// A single snapshot larger than the whole budget must still be usable —
    /// evicting it would leave undo silently doing nothing on a huge set.
    #[test]
    fn keeps_a_single_oversized_snapshot() {
        let mut r = UndoRing::new();
        r.snap(1, "z".repeat(MAX_BYTES * 2));
        assert_eq!(r.len(), 1);
        assert!(r.peek(1).is_some());
    }

    #[test]
    fn clear_empties() {
        let mut r = UndoRing::new();
        r.snap(1, "abc".into());
        r.note_noop(1);
        r.clear();
        assert!(r.is_empty());
        assert_eq!(r.bytes(), 0);
        assert_eq!(r.take_noop(), None);
    }

    #[test]
    fn noop_is_drained_once() {
        let mut r = UndoRing::new();
        r.note_noop(7);
        assert_eq!(r.take_noop(), Some(7));
        assert_eq!(r.take_noop(), None);
    }
}
