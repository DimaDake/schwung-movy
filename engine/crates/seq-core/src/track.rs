//! Per-track state: 8 clip slots (one row in session mode), playback
//! position, mute. Playback position lives here; the Engine drives it.

use crate::clip::Clip;

pub const NUM_TRACKS: usize = 4;
pub const CLIPS_PER_TRACK: usize = 8;

#[derive(Debug, Clone)]
pub struct Track {
    pub clips: Vec<Clip>,
    /// Selected clip slot — the target of note entry/editing.
    pub active_clip: usize,
    /// Slot currently playing (None = stopped). Distinct from `active_clip`
    /// so Session mode can edit one clip while another plays.
    pub playing_slot: Option<usize>,
    /// Slot queued to launch at the next bar boundary.
    pub queued_slot: Option<usize>,
    /// Stop this track's clip at the next bar boundary.
    pub pending_stop: bool,
    /// Position inside the playing clip in ticks; valid while transport runs.
    pub pos_tick: u32,
    pub muted: bool,
    /// Automation lane state (per track, shared across the track's clips —
    /// mirrors the chain slot's 8 knob mappings). label = "target:param".
    pub lane_assigned: [bool; 8],
    pub lane_base: [u8; 8],
    pub lane_label: [String; 8],
    /// Last step automation was emitted for (per track) — see engine emission.
    pub last_auto_step: i32,
    /// Per-lane value currently applied during playback (`-1` = none emitted
    /// yet → force emit). The latch carry: an unlocked, note-free step holds
    /// this. Runtime-only (derived; not persisted).
    pub auto_cur: [i16; 8],
    /// 1-based pattern play count for the playing clip, for A:B trig conditions.
    /// Reset to 1 on (re)start/launch, incremented on each loop wrap. Not persisted.
    pub cycle: u32,
    /// Fixed-point accumulator for the clip's playback scale: each master tick
    /// adds `scale_num`; while it reaches `scale_den` one clip tick fires. Lets
    /// scales >1 run several ticks per master tick and <1 run one every few.
    /// Runtime-only (not persisted).
    pub scale_acc: u32,
}

impl Default for Track {
    fn default() -> Self {
        Track::new()
    }
}

impl Track {
    pub fn new() -> Self {
        Track {
            clips: (0..CLIPS_PER_TRACK).map(|_| Clip::new()).collect(),
            active_clip: 0,
            playing_slot: None,
            queued_slot: None,
            pending_stop: false,
            pos_tick: 0,
            muted: false,
            lane_assigned: [false; 8],
            lane_base: [0u8; 8],
            lane_label: Default::default(),
            last_auto_step: -1,
            auto_cur: [-1; 8],
            cycle: 1,
            scale_acc: 0,
        }
    }

    /// The selected clip (edit target).
    pub fn active(&self) -> &Clip {
        &self.clips[self.active_clip]
    }

    pub fn active_mut(&mut self) -> &mut Clip {
        let i = self.active_clip;
        &mut self.clips[i]
    }

    /// The clip currently producing playback, if any.
    pub fn playing(&self) -> Option<&Clip> {
        self.playing_slot.map(|s| &self.clips[s])
    }

    /// Current step index within the playing clip (for the playhead LED).
    pub fn current_step(&self) -> u16 {
        (self.pos_tick / crate::TICKS_PER_STEP) as u16
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_track_cycle_is_one() {
        assert_eq!(Track::new().cycle, 1);
    }

    #[test]
    fn new_track_has_unassigned_lanes() {
        let t = Track::new();
        assert_eq!(t.lane_assigned, [false; 8]);
        assert_eq!(t.lane_base, [0u8; 8]);
        assert!(t.lane_label.iter().all(|s| s.is_empty()));
    }
}
