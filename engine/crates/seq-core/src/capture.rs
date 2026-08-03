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

/// Candidate-tempo search range. Matches what the Set page's TEMPO knob will
/// accept in practice, so Capture never suggests a BPM you could not then dial
/// by hand.
pub const BPM_MIN: u32 = 40;
pub const BPM_MAX: u32 = 250;

pub struct TempoGuess {
    /// Ascending; `n` entries filled from index 0.
    pub cands: [u32; 3],
    /// Index into `cands` of the best-scoring tempo.
    pub best: usize,
    pub n: usize,
}

fn ratio(a: u32, b: u32) -> f64 {
    let (a, b) = (a as f64, b.max(1) as f64);
    if a > b { a / b } else { b / a }
}

/// Score how well `onsets` (frames, relative to the first note) sit on a 1/16
/// grid at each integer BPM, and return the three tempos worth offering.
///
/// Grid fit alone cannot pick a winner: evenly spaced input fits a whole family
/// of tempos exactly (120 in quarters is 90 in dotted eighths is 160 in
/// triplets), so two weak tie-breakers decide between them — whether the take
/// spans a whole number of bars, and how far the tempo sits from a comfortable
/// 120. Both are small enough that a genuinely better grid fit always wins.
pub fn estimate_tempos(onsets: &[u64], span: u64, sample_rate: u32) -> Option<TempoGuess> {
    if onsets.len() < 3 {
        return None;
    }
    let sr = sample_rate as f64;
    let span = span.max(1) as f64;

    let score_at = |bpm: u32| -> f64 {
        let fpb = sr * 60.0 / bpm as f64;
        let fit = onsets
            .iter()
            .map(|&o| {
                let beats = o as f64 / fpb;
                (beats - (beats * 4.0).round() / 4.0).abs()
            })
            .sum::<f64>()
            / onsets.len() as f64;
        let bars = span / fpb / 4.0;
        let bar_err = (bars - bars.round()).abs();
        let octave = (bpm as f64 / 120.0).ln().abs();
        fit + 0.02 * bar_err + 0.02 * octave
    };
    let scores: Vec<f64> = (BPM_MIN..=BPM_MAX).map(score_at).collect();

    // Local minima, best first. Tempos within 5% of one another are the same
    // tempo heard twice, so only the better of the pair survives.
    let mut minima: Vec<(u32, f64)> = Vec::new();
    for (i, &s) in scores.iter().enumerate() {
        let lo = i == 0 || scores[i - 1] >= s;
        let hi = i + 1 == scores.len() || scores[i + 1] > s;
        if lo && hi {
            minima.push((BPM_MIN + i as u32, s));
        }
    }
    minima.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(core::cmp::Ordering::Equal));
    let mut distinct: Vec<u32> = Vec::new();
    for (bpm, _) in minima {
        if distinct.iter().all(|&d| ratio(d, bpm) >= 1.05) {
            distinct.push(bpm);
        }
    }
    let best_bpm = *distinct.first()?;

    // The half- and double-time readings of the winner are what a player
    // actually reaches for, so they outrank any lesser local minimum.
    let mut picked = vec![best_bpm];
    for partner in [best_bpm / 2, best_bpm * 2] {
        if (BPM_MIN..=BPM_MAX).contains(&partner)
            && picked.iter().all(|&p| ratio(p, partner) >= 1.05)
        {
            picked.push(partner);
        }
    }
    for &d in &distinct {
        if picked.len() >= 3 {
            break;
        }
        if picked.iter().all(|&p| ratio(p, d) >= 1.05) {
            picked.push(d);
        }
    }

    let n = picked.len().min(3);
    picked.truncate(n);
    picked.sort_unstable();
    let mut cands = [0u32; 3];
    cands[..n].copy_from_slice(&picked);
    let best = picked.iter().position(|&b| b == best_bpm).unwrap_or(0);
    Some(TempoGuess { cands, best, n })
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

    /// Onsets for `n` eighth-notes at `bpm`, in frames from the first.
    fn eighths(bpm: f64, n: usize, sr: u32) -> Vec<u64> {
        let fpb = sr as f64 * 60.0 / bpm;
        (0..n).map(|i| (i as f64 * fpb / 2.0) as u64).collect()
    }

    #[test]
    fn recovers_the_played_tempo() {
        let on = eighths(100.0, 16, 44100);
        let g = estimate_tempos(&on, *on.last().unwrap(), 44100).unwrap();
        assert_eq!(g.cands[g.best], 100);
    }

    #[test]
    fn offers_the_half_and_double_time_partners() {
        let on = eighths(100.0, 16, 44100);
        let g = estimate_tempos(&on, *on.last().unwrap(), 44100).unwrap();
        assert_eq!(g.n, 3);
        assert_eq!(g.cands, [50, 100, 200], "ascending, partners included");
    }

    #[test]
    fn candidates_stay_inside_the_dial_range_and_stay_full() {
        // 240 doubles to 480 (out of range) — the third slot must be backfilled,
        // never left empty, so the selector always has something to scroll.
        let on = eighths(240.0, 16, 44100);
        let g = estimate_tempos(&on, *on.last().unwrap(), 44100).unwrap();
        assert_eq!(g.n, 3);
        assert!(g.cands.iter().all(|&b| (BPM_MIN..=BPM_MAX).contains(&b)));
        assert!(g.cands.windows(2).all(|w| w[0] < w[1]), "ascending, no dupes");
    }

    #[test]
    fn survives_the_jitter_a_real_take_arrives_with() {
        // Pad notes reach the engine batched once per UI tick, so onsets carry
        // up to ~16 ms of quantization on top of human timing. A tempo the
        // estimator can only find on perfect input would be useless.
        let sr = 44100;
        let mut on = eighths(120.0, 16, sr);
        let mut seed = 0x2545F491u32;
        for o in on.iter_mut() {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let jitter = (seed >> 24) as u64 * 16 * sr as u64 / 1000 / 256; // 0..16 ms
            *o += jitter;
        }
        let g = estimate_tempos(&on, *on.last().unwrap(), sr).unwrap();
        assert_eq!(g.cands[g.best], 120, "got {:?}", g.cands);
    }

    #[test]
    fn two_notes_are_not_a_tempo() {
        assert!(estimate_tempos(&[0, 22050], 22050, 44100).is_none());
    }
}
