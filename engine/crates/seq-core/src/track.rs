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
