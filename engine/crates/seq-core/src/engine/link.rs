//! Following an Ableton Link session (link_follow.rs has the arithmetic).
//!
//! Called once per block BEFORE `advance_block`, with the time this block's
//! first sample leaves Move. Inactive (setting off, or nobody else in the
//! session) it changes nothing, so movy without Link is movy as it was.

use super::{Engine, OutEvent};
use crate::link_follow::{bpm_x100_of, next_bar, trim_for, wrap_phase, PLAY_TIMEOUT_US};
use crate::link_follow::LinkSnapshot;

impl Engine {
    pub fn link_block(&mut self, snap: &LinkSnapshot, out_us: u64, frames: u32, out: &mut Vec<OutEvent>) {
        let was = self.link.active();
        self.link.snap = *snap;
        self.link.last_out_us = out_us;
        if !self.link.active() {
            if was {
                // Left alone: keep playing, at the tempo we had.
                self.clock.set_trim_ppm(0);
                self.link.pending_start = None;
            }
            if self.link.play_wait_since.take().is_some() && !self.playing {
                self.play();
            }
            return;
        }
        if !was {
            self.link.joined_at_us = out_us;
            self.link.last_playing = snap.is_playing;
        }
        if !self.link.tempo_pending() {
            let b = bpm_x100_of(snap.tempo);
            if b != self.clock.bpm_x100() {
                self.clock.set_bpm_x100(b);
            }
        }
        self.link_edges(snap, out);
        if let Some(since) = self.link.play_wait_since {
            if self.link.pending_start.is_none() && out_us >= since + PLAY_TIMEOUT_US {
                self.link.play_wait_since = None;
                if !self.playing {
                    self.play();
                }
            }
        }
        let now = snap.beat_at(out_us);
        if let Some(bar) = self.link.pending_start {
            let block_beats = frames as f64 * snap.tempo / 60.0 / self.clock.sample_rate() as f64;
            if now + block_beats > bar {
                self.link.pending_start = None;
                self.link.play_wait_since = None;
                self.clock.set_trim_ppm(0);
                self.play();
            }
            return;
        }
        if let Some(mine) = self.beat_position() {
            match trim_for(wrap_phase(now - mine)) {
                Some(ppm) => self.clock.set_trim_ppm(ppm),
                None => {
                    // Too far off to pull in: restart on the session's next bar.
                    self.clock.set_trim_ppm(0);
                    self.link.pending_start = Some(next_bar(now));
                }
            }
        }
    }

    /// Start/stop edges that happened after we joined; earlier ones are the
    /// session's history (joining a stopped session never stops movy).
    fn link_edges(&mut self, snap: &LinkSnapshot, out: &mut Vec<OutEvent>) {
        if snap.is_playing == self.link.last_playing {
            return;
        }
        self.link.last_playing = snap.is_playing;
        if snap.play_change_us < self.link.joined_at_us {
            return;
        }
        if snap.is_playing {
            self.link.pending_start = Some(next_bar(snap.beat_at(snap.play_change_us)));
        } else {
            self.link.pending_start = None;
            self.link.play_wait_since = None;
            if self.playing {
                self.stop(out);
            }
        }
    }

    /// The Play button. With peers it starts on the session's grid: either
    /// the session is already running (join its next bar) or our request
    /// starts it and the edge comes back.
    pub fn play_requested(&mut self) {
        let at = self.link.last_out_us;
        if self.link.enabled() {
            let r = &mut self.link.req;
            r.play_seq = r.play_seq.wrapping_add(1);
            r.playing = true;
            r.play_at_us = at;
        }
        if !self.link.active() {
            self.play();
            return;
        }
        if self.link.snap.is_playing {
            self.link.pending_start = Some(next_bar(self.link.snap.beat_at(at)));
        } else {
            self.link.play_wait_since = Some(at);
        }
    }

    /// The Stop button: at once, and the session hears it.
    pub fn stop_requested(&mut self, out: &mut Vec<OutEvent>) {
        if self.link.enabled() {
            let r = &mut self.link.req;
            r.play_seq = r.play_seq.wrapping_add(1);
            r.playing = false;
            r.play_at_us = self.link.last_out_us;
        }
        self.link.pending_start = None;
        self.link.play_wait_since = None;
        self.stop(out);
    }

    /// A tempo set on movy: ours at once, and the session's once it answers.
    pub fn tempo_requested(&mut self, bpm_x100: u32) {
        self.clock.set_bpm_x100(bpm_x100);
        if self.link.enabled() {
            let r = &mut self.link.req;
            r.tempo_seq = r.tempo_seq.wrapping_add(1);
            r.tempo_bpm_x100 = self.clock.bpm_x100();
        }
    }
}
