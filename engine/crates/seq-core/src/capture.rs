//! Retroactive capture: a rolling ring of live pad input, kept whether or not
//! the transport runs, so Capture can turn what was just played into clip data
//! (Move manual §14.3). Transient — never serialized.
//!
//! The tempo estimator below is movy's own: schwung-davebox shipped capture
//! first, but it is PolyForm Noncommercial and movy is MIT, so nothing is
//! ported. Onset-versus-grid tempo induction is a published technique; the
//! scoring terms and weights here were tuned against this file's tests.

/// Fixed ring capacity. Notes only (no CC), so one phrase is ~2 events per
/// note; 512 covers far more than the gap timer will ever keep alive.
pub const CAP_MAX_EVENTS: usize = 512;

#[derive(Clone, Copy)]
pub struct CapEvent {
    /// Monotonic audio-frame stamp — the only clock that runs while stopped.
    pub frame: u64,
    /// Absolute master tick at arrival (overdub placement while playing).
    pub abs_tick: u32,
    /// The track's playhead position within its clip at arrival.
    pub clip_tick: u32,
    pub track: u8,
    pub on: bool,
    pub pitch: u8,
    pub vel: u8,
}

/// What the post-capture overlay is showing.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CapMode {
    /// No overlay (nothing captured, or captured while the transport ran).
    None,
    /// The tempo was ours to set — the user can wheel through the candidates.
    Select,
    /// The tempo was fixed; the take was fitted to it and the overlay explains.
    Fixed,
}

/// Why a capture could not set the tempo.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CapWhy {
    None,
    /// An external clock (Move) owns the tempo.
    Ext,
    /// The target clip already has notes — this is an overdub, not a new take.
    Notes,
}

pub struct CaptureRing {
    events: Vec<CapEvent>,
    head: usize,
    len: usize,
    last_frame: u64,
}

impl CaptureRing {
    pub fn new() -> Self {
        CaptureRing {
            events: Vec::with_capacity(CAP_MAX_EVENTS),
            head: 0,
            len: 0,
            last_frame: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn clear(&mut self) {
        self.head = 0;
        self.len = 0;
    }

    /// Append one event. `gap_frames` of silence since the last one means the
    /// buffered input is stale — it belongs to a phrase the player has already
    /// moved on from, so it is dropped rather than glued onto the new take.
    pub fn push(&mut self, ev: CapEvent, gap_frames: u64) {
        if self.len > 0 && ev.frame.saturating_sub(self.last_frame) > gap_frames {
            self.clear();
        }
        self.last_frame = ev.frame;
        // Grows to capacity once and is then indexed in place forever: this
        // runs on the audio thread, where a reallocation is a dropped block.
        if self.events.len() < CAP_MAX_EVENTS {
            self.events.push(ev);
            self.len += 1;
            return;
        }
        let slot = (self.head + self.len) % CAP_MAX_EVENTS;
        self.events[slot] = ev;
        if self.len == CAP_MAX_EVENTS {
            self.head = (self.head + 1) % CAP_MAX_EVENTS;
        } else {
            self.len += 1;
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = &CapEvent> {
        (0..self.len).map(move |i| &self.events[(self.head + i) % CAP_MAX_EVENTS])
    }

    /// Note-ons buffered for one track — drives the Capture LED and the
    /// "nothing to capture" guard.
    pub fn pending(&self, track: u8) -> usize {
        self.iter().filter(|e| e.track == track && e.on).count()
    }
}

impl Default for CaptureRing {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(frame: u64, track: u8, on: bool, pitch: u8) -> CapEvent {
        CapEvent { frame, abs_tick: 0, clip_tick: 0, track, on, pitch, vel: 100 }
    }

    #[test]
    fn pending_counts_note_ons_for_one_track() {
        let mut r = CaptureRing::new();
        r.push(ev(0, 0, true, 60), 1000);
        r.push(ev(10, 0, false, 60), 1000);
        r.push(ev(20, 1, true, 62), 1000);
        assert_eq!(r.pending(0), 1);
        assert_eq!(r.pending(1), 1);
        assert_eq!(r.pending(2), 0);
    }

    #[test]
    fn silence_longer_than_the_gap_starts_a_new_take() {
        let mut r = CaptureRing::new();
        r.push(ev(0, 0, true, 60), 1000);
        r.push(ev(500, 0, true, 62), 1000);
        assert_eq!(r.pending(0), 2);
        r.push(ev(2000, 0, true, 64), 1000); // 1500 frames of silence > gap
        assert_eq!(r.pending(0), 1, "stale input dropped, fresh take begins");
    }

    #[test]
    fn overflow_drops_the_oldest_event() {
        let mut r = CaptureRing::new();
        for i in 0..(CAP_MAX_EVENTS as u64 + 10) {
            r.push(ev(i, 0, true, 60), u64::MAX);
        }
        assert_eq!(r.len(), CAP_MAX_EVENTS);
        assert_eq!(r.iter().next().unwrap().frame, 10, "oldest 10 dropped");
    }

    #[test]
    fn clear_empties_the_ring() {
        let mut r = CaptureRing::new();
        r.push(ev(0, 0, true, 60), 1000);
        r.clear();
        assert_eq!(r.pending(0), 0);
    }
}
