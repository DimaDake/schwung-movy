//! Routing live pad notes to a movy chain on the audio thread.
//!
//! **Why this exists.** A pad note on a HOST track reaches its synth through
//! `shadow_send_midi_to_dsp` — one non-blocking shm write. A movy track has no
//! shadow slot, so movy sent each note as a *blocking* engine param write
//! instead. Measured on device: 2.12 ms of IPC per tick against 0.30 ms for a
//! host track, and because it blocks, a chord multiplies it.
//!
//! The shim already delivers internal cable-0 note events to the overtake DSP's
//! `on_midi` on the audio thread (`schwung_shim.c:6950`), explicitly so an
//! overtake tool can take pad input without a JS round trip. Confirmed on device
//! by probe: physical pad presses arrive here as 3-byte note-ons. So the note
//! never has to leave the audio thread at all.
//!
//! **What the UI still owns.** The pad→pitch mapping (scale, octave, layout,
//! drum lane) stays in the UI, which pushes the whole 32-entry map whenever it
//! changes. The DSP only looks up and forwards.
//!
//! **The ledger rule.** A note-off is answered from what the note-ON recorded,
//! never from the current map. movy's UI learned this the hard way (see
//! `keyboard/held-notes.ts`): if the octave, track or layout changes while a pad
//! is held, deriving the pitch again at release sends a note-off for a note that
//! was never started, and the real one sustains forever.

/// Pad note range movy uses (MovePads): 68..99 inclusive.
pub const PAD_MIN: u8 = 68;
pub const PAD_COUNT: usize = 32;

#[derive(Debug)]
pub struct PadRoute {
    /// Chain index that owns live pads, or -1 when the active track is a host
    /// track (the UI sends those itself, as before).
    chain: i32,
    /// Pad index -> pitch, -1 for a dead pad.
    map: [i16; PAD_COUNT],
    /// What each pad actually started, so its note-off matches: (chain, pitch).
    held: [Option<(usize, u8)>; PAD_COUNT],
    /// Full Velocity: every pad note leaves at 127, whatever it was hit with.
    /// The UI owns the setting (Shift + Step 10) and pushes it here, for the
    /// same reason it pushes the map — the note is built on the audio thread,
    /// so a decision the UI makes about it has to travel with it.
    full_vel: bool,
}

impl Default for PadRoute {
    fn default() -> Self {
        Self::new()
    }
}

impl PadRoute {
    pub fn new() -> Self {
        Self { chain: -1, map: [-1; PAD_COUNT], held: [None; PAD_COUNT], full_vel: false }
    }

    /// Apply a pushed map: `"<chain>,<p0>,<p1>,…,<p31>"`. A malformed payload is
    /// ignored wholesale rather than half-applied — a partially updated map
    /// would send notes to pitches the UI never chose.
    pub fn set_map(&mut self, val: &str) -> bool {
        let mut it = val.split(',');
        let Some(chain) = it.next().and_then(|s| s.trim().parse::<i32>().ok()) else {
            return false;
        };
        let mut next = [-1i16; PAD_COUNT];
        let mut n = 0;
        for (i, tok) in it.enumerate() {
            if i >= PAD_COUNT {
                return false;
            }
            let Ok(p) = tok.trim().parse::<i16>() else { return false };
            next[i] = p;
            n += 1;
        }
        if n != PAD_COUNT {
            return false;
        }
        self.chain = chain;
        self.map = next;
        true
    }

    /// Full Velocity on or off. Held notes are left alone: the velocity is
    /// fixed when the note starts, and a note-off carries none.
    pub fn set_full_velocity(&mut self, on: bool) {
        self.full_vel = on;
    }

    /// True when the DSP is handling pads (so the UI must not also send them).
    pub fn active(&self) -> bool {
        self.chain >= 0
    }

    /// Resolve a pad event. Returns `(chain, pitch, velocity, on)` to forward,
    /// or None.
    ///
    /// Note-ONs consult the map; note-OFFs consult the ledger, so a map that
    /// changed mid-hold cannot strand the note. The velocity is decided here
    /// rather than by the caller so Full Velocity cannot be applied on one pad
    /// path and forgotten on another — which is exactly how it shipped: the UI
    /// applied it to the notes it sent, and the notes the engine answers came
    /// out with whatever the pad was hit with.
    pub fn route(&mut self, status: u8, d1: u8, d2: u8) -> Option<(usize, u8, u8, bool)> {
        if d1 < PAD_MIN || (d1 as usize) >= PAD_MIN as usize + PAD_COUNT {
            return None;
        }
        let idx = (d1 - PAD_MIN) as usize;
        match status & 0xF0 {
            0x90 => {
                let chain = self.chain;
                if chain < 0 {
                    return None;
                }
                let pitch = self.map[idx];
                if pitch < 0 || pitch > 127 {
                    return None; // dead pad (piano gap, out of range)
                }
                self.held[idx] = Some((chain as usize, pitch as u8));
                let vel = if self.full_vel { 127 } else { d2 };
                Some((chain as usize, pitch as u8, vel, true))
            }
            0x80 => {
                // From the ledger, whatever the map says now.
                let (chain, pitch) = self.held[idx].take()?;
                Some((chain, pitch, 0, false))
            }
            _ => None,
        }
    }

    /// Every note the pads still hold, cleared. Used on teardown and whenever
    /// the routing target changes, so nothing sustains on a chain the user has
    /// navigated away from.
    pub fn drain_held(&mut self) -> Vec<(usize, u8)> {
        let mut out = Vec::new();
        for slot in self.held.iter_mut() {
            if let Some(v) = slot.take() {
                out.push(v);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map_for(chain: i32, base: i16) -> String {
        let mut s = chain.to_string();
        for i in 0..PAD_COUNT {
            s.push(',');
            s.push_str(&(base + i as i16).to_string());
        }
        s
    }

    #[test]
    fn routes_a_pad_to_the_mapped_pitch() {
        let mut r = PadRoute::new();
        assert!(r.set_map(&map_for(2, 60)));
        assert_eq!(r.route(0x90, PAD_MIN, 100), Some((2, 60, 100, true)));
        assert_eq!(r.route(0x90, PAD_MIN + 5, 100), Some((2, 65, 100, true)));
    }

    #[test]
    fn inactive_until_a_chain_is_named() {
        let mut r = PadRoute::new();
        assert!(!r.active(), "no map pushed yet");
        assert_eq!(r.route(0x90, PAD_MIN, 100), None);
        r.set_map(&map_for(-1, 60));
        assert!(!r.active(), "chain -1 means the UI owns pads (host track)");
        assert_eq!(r.route(0x90, PAD_MIN, 100), None);
    }

    #[test]
    fn note_off_follows_the_ledger_not_the_current_map() {
        // The rule movy's UI learned the hard way: if the map changes while a
        // pad is held, releasing it must still close the note that was STARTED.
        let mut r = PadRoute::new();
        r.set_map(&map_for(0, 60));
        assert_eq!(r.route(0x90, PAD_MIN, 100), Some((0, 60, 100, true)));

        r.set_map(&map_for(0, 72));                       // octave up mid-hold
        assert_eq!(r.route(0x80, PAD_MIN, 0), Some((0, 60, 0, false)),
            "the note-off must close pitch 60, not the newly mapped 72");
    }

    #[test]
    fn note_off_follows_the_ledger_across_a_chain_change() {
        let mut r = PadRoute::new();
        r.set_map(&map_for(1, 60));
        r.route(0x90, PAD_MIN, 100);
        r.set_map(&map_for(7, 60));                       // switched track
        assert_eq!(r.route(0x80, PAD_MIN, 0), Some((1, 60, 0, false)),
            "the off goes to the chain that started it");
    }

    #[test]
    fn an_unheld_release_is_ignored() {
        let mut r = PadRoute::new();
        r.set_map(&map_for(0, 60));
        assert_eq!(r.route(0x80, PAD_MIN, 0), None, "no phantom note-off");
    }

    #[test]
    fn dead_pads_sound_nothing() {
        let mut r = PadRoute::new();
        let mut m = String::from("0");
        for _ in 0..PAD_COUNT { m.push_str(",-1"); }
        r.set_map(&m);
        assert_eq!(r.route(0x90, PAD_MIN, 100), None);
    }

    #[test]
    fn notes_outside_the_pad_range_are_not_ours() {
        let mut r = PadRoute::new();
        r.set_map(&map_for(0, 60));
        assert_eq!(r.route(0x90, 16, 100), None, "step buttons are not pads");
        assert_eq!(r.route(0x90, PAD_MIN + PAD_COUNT as u8, 100), None);
    }

    #[test]
    fn a_malformed_map_is_refused_whole() {
        let mut r = PadRoute::new();
        r.set_map(&map_for(3, 60));
        assert!(!r.set_map("2,1,2,3"), "too few entries");
        assert!(!r.set_map("notanumber,1"), "bad chain");
        // The good map must survive a refused one.
        assert_eq!(r.route(0x90, PAD_MIN, 100), Some((3, 60, 100, true)));
    }

    #[test]
    fn drain_returns_everything_still_held() {
        let mut r = PadRoute::new();
        r.set_map(&map_for(0, 60));
        r.route(0x90, PAD_MIN, 100);
        r.route(0x90, PAD_MIN + 1, 100);
        let mut got = r.drain_held();
        got.sort();
        assert_eq!(got, vec![(0, 60), (0, 61)]);
        assert!(r.drain_held().is_empty(), "draining twice yields nothing");
    }

    #[test]
    fn a_pad_carries_the_velocity_it_was_hit_with() {
        let mut r = PadRoute::new();
        r.set_map(&map_for(0, 60));
        assert_eq!(r.route(0x90, PAD_MIN, 41), Some((0, 60, 41, true)));
        assert_eq!(r.route(0x90, PAD_MIN + 1, 118), Some((0, 61, 118, true)));
    }

    #[test]
    fn full_velocity_replaces_what_the_pad_was_hit_with() {
        // Shift + Step 10. The UI can no longer apply this itself for a movy
        // track — it does not send those notes at all — so a soft press must
        // leave HERE at 127 or the toggle does nothing the player can hear.
        let mut r = PadRoute::new();
        r.set_map(&map_for(0, 60));
        r.set_full_velocity(true);
        assert_eq!(r.route(0x90, PAD_MIN, 41), Some((0, 60, 127, true)));
        assert_eq!(r.route(0x90, PAD_MIN + 1, 1), Some((0, 61, 127, true)));

        r.set_full_velocity(false);
        assert_eq!(r.route(0x90, PAD_MIN + 2, 41), Some((0, 62, 41, true)),
            "switching it off gives the player their dynamics back");
    }

    #[test]
    fn full_velocity_does_not_disturb_a_release() {
        let mut r = PadRoute::new();
        r.set_map(&map_for(0, 60));
        r.set_full_velocity(true);
        r.route(0x90, PAD_MIN, 41);
        assert_eq!(r.route(0x80, PAD_MIN, 0), Some((0, 60, 0, false)));
    }
}
