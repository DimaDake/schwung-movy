//! Per-track state: 8 clip slots (one row in session mode), playback
//! position, mute. Playback position lives here; the Engine drives it.

use crate::clip::Clip;

pub const NUM_TRACKS: usize = 16;
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
    /// Slot to select when the next bar boundary lands. A scene moves every
    /// track's selection to its column, but a track the scene STOPS has no
    /// queued launch to carry that across — and doing it at press time would
    /// move the selection (and a running take) a bar before the scene it names
    /// actually plays. Runtime-only; not persisted.
    pub pending_select: Option<usize>,
    /// Position inside the playing clip in ticks; valid while transport runs.
    pub pos_tick: u32,
    pub muted: bool,
    /// Drum-pad mutes: the MIDI notes whose voices the sequencer must not
    /// emit. One entry per muted voice, in the order they were muted.
    ///
    /// Empty on every melodic track, and empty is the ordinary case — a pad
    /// mute can only be set on a drum track's rack, so nothing downstream needs
    /// to ask whether this track is a drum track. Unlike `muted` there is no
    /// host-level gate to mirror: this is movy's own control, so it gates
    /// sequenced notes and leaves live pad playing audible (see `pad_solo`).
    pub pad_mutes: Vec<u8>,
    /// The note of the one soloed drum pad, if any. Exclusive per track — a
    /// second solo moves it rather than adding — which is what keeps the gate
    /// a single comparison instead of a set.
    ///
    /// Held BESIDE `pad_mutes` rather than derived from it. The track mute has
    /// to derive (one bool per track cannot hold both), so the UI keeps a
    /// `base` of the user's own mutes and restores them when the last solo
    /// drops. Both fields living here means the user's mutes are never
    /// overwritten and un-soloing needs no bookkeeping to undo.
    pub pad_solo: Option<u8>,
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
            pending_select: None,
            pos_tick: 0,
            muted: false,
            pad_mutes: Vec::new(),
            pad_solo: None,
            lane_assigned: [false; 8],
            lane_base: [0u8; 8],
            lane_label: Default::default(),
            last_auto_step: -1,
            auto_cur: [-1; 8],
            cycle: 1,
            scale_acc: 0,
        }
    }

    /// Add or remove one voice's pad mute, keeping the list a set.
    pub fn set_pad_mute(&mut self, note: u8, muted: bool) {
        match (muted, self.pad_mutes.iter().position(|&n| n == note)) {
            (true, None) => self.pad_mutes.push(note),
            // `remove`, not `swap_remove`: the list is serialized in order, and
            // a stable order keeps the persisted bytes of an unchanged set
            // unchanged.
            (false, Some(i)) => {
                self.pad_mutes.remove(i);
            }
            _ => {}
        }
    }

    /// Is this voice silenced by the track's own pad mute/solo? The ONE
    /// definition of it: the note gate, the gate flush and the status report
    /// all ask here, so a muted voice cannot be silent in one place and
    /// sounding in another.
    ///
    /// Solo is checked first and stands alone: while a solo is up the mute set
    /// is not consulted, so the soloed voice sounds even if it was muted —
    /// the precedence the track mute settled on.
    pub fn pad_voice_silent(&self, pitch: u8) -> bool {
        match self.pad_solo {
            Some(s) => s != pitch,
            None => self.pad_mutes.contains(&pitch),
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
