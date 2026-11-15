//! Ableton Link, the engine's side (docs/superpowers/specs/2026-11-15-ableton-
//! link-design.md). movy-link owns the session; what reaches the engine each
//! block is a `LinkSnapshot` of its timeline, and what goes back is a
//! `LinkRequests`. Everything here is pure arithmetic on those two, so the
//! follow behaviour is tested on the host without a network.

/// One bar of 4/4: the phase every Link peer agrees on.
pub const QUANTUM: f64 = 4.0;
/// Below this phase error (beats) the clock is trimmed; at or above it the
/// transport re-anchors on the session's next bar.
pub const TRIM_WINDOW: f64 = 0.125;
/// Trim gain, ppm per beat of error: about a 5 s time constant at 120 BPM.
pub const TRIM_GAIN: f64 = 100_000.0;
/// A start request movy-link never answered: movy starts on its own.
pub const PLAY_TIMEOUT_US: u64 = 500_000;
/// A session start this close (beats) to a bar line counts as on it.
pub const ON_BAR: f64 = 1.0 / 64.0;

/// The session as movy-link last published it. Times are µs on
/// CLOCK_MONOTONIC_RAW, the Link SDK's clock.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct LinkSnapshot {
    pub enabled: bool,
    pub peers: u32,
    pub tempo: f64,
    pub beat_anchor: f64,
    pub time_anchor_us: u64,
    pub is_playing: bool,
    pub play_change_us: u64,
    pub tempo_ack_seq: u32,
    pub play_ack_seq: u32,
}

impl LinkSnapshot {
    /// Link's own timeline model: a straight line through the anchor.
    pub fn beat_at(&self, t_us: u64) -> f64 {
        self.beat_anchor + (t_us as f64 - self.time_anchor_us as f64) * self.tempo / 60e6
    }
}

/// What the engine asks of the session. A new `seq` is a new request;
/// movy-link answers it by echoing the seq in the snapshot's `*_ack_seq`.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct LinkRequests {
    pub tempo_seq: u32,
    pub tempo_bpm_x100: u32,
    pub play_seq: u32,
    pub playing: bool,
    pub play_at_us: u64,
}

#[derive(Clone, Default, Debug)]
pub struct LinkFollow {
    pub(crate) snap: LinkSnapshot,
    pub(crate) req: LinkRequests,
    /// When the current session was joined; start/stop edges from before it
    /// are the session's history, not a command to movy.
    pub(crate) joined_at_us: u64,
    pub(crate) last_playing: bool,
    /// The session beat (a multiple of `QUANTUM`) movy's bar 0 waits for.
    pub(crate) pending_start: Option<f64>,
    /// A local Play waiting for the session to start.
    pub(crate) play_wait_since: Option<u64>,
    pub(crate) last_out_us: u64,
}

impl LinkFollow {
    /// Following the session: the setting is on and someone else is in it.
    pub fn active(&self) -> bool {
        self.snap.enabled && self.snap.peers > 0
    }

    pub fn enabled(&self) -> bool {
        self.snap.enabled
    }

    pub fn peers(&self) -> u32 {
        self.snap.peers
    }

    pub fn requests(&self) -> &LinkRequests {
        &self.req
    }

    /// The engine's own tempo request is still in flight: the session's tempo
    /// is the old one and must not overwrite the new.
    pub(crate) fn tempo_pending(&self) -> bool {
        (self.req.tempo_seq.wrapping_sub(self.snap.tempo_ack_seq) as i32) > 0
    }
}

/// `x` folded into (-QUANTUM/2, QUANTUM/2].
pub fn wrap_phase(x: f64) -> f64 {
    let r = x.rem_euclid(QUANTUM);
    if r > QUANTUM / 2.0 { r - QUANTUM } else { r }
}

/// The first bar line at or after `beat`, where "just past" one by less than
/// `ON_BAR` still counts as on it.
pub fn next_bar(beat: f64) -> f64 {
    ((beat - ON_BAR) / QUANTUM).ceil() * QUANTUM
}

/// The trim for a phase error, or None when the error is too large to trim.
pub fn trim_for(err: f64) -> Option<i32> {
    if err.abs() >= TRIM_WINDOW {
        return None;
    }
    let max = crate::clock::TRIM_PPM_MAX as f64;
    Some((err * TRIM_GAIN).round().clamp(-max, max) as i32)
}

/// A session tempo as the clock stores it, inside the clock's range.
pub fn bpm_x100_of(tempo: f64) -> u32 {
    use crate::clock::{BPM_X100_MAX, BPM_X100_MIN};
    if !tempo.is_finite() {
        return BPM_X100_MIN;
    }
    ((tempo * 100.0).round().max(0.0) as u32).clamp(BPM_X100_MIN, BPM_X100_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beat_at_extrapolates() {
        let s = LinkSnapshot { tempo: 120.0, beat_anchor: 8.0, time_anchor_us: 1_000_000, ..Default::default() };
        assert_eq!(s.beat_at(1_000_000), 8.0);
        assert!((s.beat_at(1_500_000) - 9.0).abs() < 1e-9, "120 BPM = 2 beats/s");
        assert!((s.beat_at(500_000) - 7.0).abs() < 1e-9, "before the anchor too");
    }

    #[test]
    fn wrap_and_bar_math() {
        assert!((wrap_phase(3.9) - -0.1).abs() < 1e-9);
        assert!((wrap_phase(-0.1) - -0.1).abs() < 1e-9);
        assert!((wrap_phase(2.0) - 2.0).abs() < 1e-9);
        assert_eq!(next_bar(4.001), 4.0, "just past a bar line is on it");
        assert_eq!(next_bar(4.5), 8.0);
        assert_eq!(next_bar(0.0), 0.0);
    }

    #[test]
    fn out_of_range_session_tempo_clamps() {
        assert_eq!(bpm_x100_of(999.0), 30000);
        assert_eq!(bpm_x100_of(5.0), 2000);
        assert_eq!(bpm_x100_of(f64::NAN), 2000);
        assert_eq!(bpm_x100_of(120.004), 12000);
        assert_eq!(trim_for(0.0001), Some(10));
        assert_eq!(trim_for(0.1), Some(5000), "clamped");
        assert_eq!(trim_for(0.2), None);
    }

    #[test]
    fn tempo_pending_wraps() {
        let mut f = LinkFollow::default();
        assert!(!f.tempo_pending());
        f.req.tempo_seq = 1;
        assert!(f.tempo_pending());
        f.snap.tempo_ack_seq = 1;
        assert!(!f.tempo_pending());
        f.req.tempo_seq = 0; // wrapped past u32::MAX
        f.snap.tempo_ack_seq = u32::MAX;
        assert!(f.tempo_pending());
    }
}
