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
}

impl Default for PadRoute {
    fn default() -> Self {
        Self::new()
    }
}

impl PadRoute {
    pub fn new() -> Self {
        Self { chain: -1, map: [-1; PAD_COUNT], held: [None; PAD_COUNT] }
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

    /// True when the DSP is handling pads (so the UI must not also send them).
    pub fn active(&self) -> bool {
        self.chain >= 0
    }

    /// Resolve a pad event. Returns `(chain, pitch, on)` to forward, or None.
    ///
    /// Note-ONs consult the map; note-OFFs consult the ledger, so a map that
    /// changed mid-hold cannot strand the note.
    pub fn route(&mut self, status: u8, d1: u8, _d2: u8) -> Option<(usize, u8, bool)> {
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
                Some((chain as usize, pitch as u8, true))
            }
            0x80 => {
                // From the ledger, whatever the map says now.
                let (chain, pitch) = self.held[idx].take()?;
                Some((chain, pitch, false))
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
        assert_eq!(r.route(0x90, PAD_MIN, 100), Some((2, 60, true)));
        assert_eq!(r.route(0x90, PAD_MIN + 5, 100), Some((2, 65, true)));
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
        assert_eq!(r.route(0x90, PAD_MIN, 100), Some((0, 60, true)));

        r.set_map(&map_for(0, 72));                       // octave up mid-hold
        assert_eq!(r.route(0x80, PAD_MIN, 0), Some((0, 60, false)),
            "the note-off must close pitch 60, not the newly mapped 72");
    }

    #[test]
    fn note_off_follows_the_ledger_across_a_chain_change() {
        let mut r = PadRoute::new();
        r.set_map(&map_for(1, 60));
        r.route(0x90, PAD_MIN, 100);
        r.set_map(&map_for(7, 60));                       // switched track
        assert_eq!(r.route(0x80, PAD_MIN, 0), Some((1, 60, false)),
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
        assert_eq!(r.route(0x90, PAD_MIN, 100), Some((3, 60, true)));
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
}
