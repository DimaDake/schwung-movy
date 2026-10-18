//! Routing an external USB-A keyboard (cable 2) to the active track's chain on
//! the audio thread.
//!
//! Same reason as `pad_route`: a UI round trip would add a tick (5-16 ms) to
//! every note. The UI owns which chain is active and, on a drum track, which
//! note each pad plays; it pushes that as `extmap` and the DSP only looks up.
//!
//! Every channel is accepted and collapsed onto channel 1, because the user
//! picks the destination by selecting a track on Move, not on the controller.
//! Note-offs come from the ledger (see `pad_route.rs` for why).

const DRUM_BASE: usize = 36;

#[derive(Debug)]
pub struct ExtRoute {
    chain: i32,
    /// Incoming note -> pitch the chain plays, -1 for a dead key.
    map: [i16; 128],
    held: [Option<(usize, u8)>; 128],
    /// Whether a wheel left its rest position on `chain`, so a chain change
    /// only resets what was actually moved.
    bent: bool,
    modded: bool,
}

impl Default for ExtRoute {
    fn default() -> Self {
        Self::new()
    }
}

impl ExtRoute {
    pub fn new() -> Self {
        Self { chain: -1, map: [-1; 128], held: [None; 128], bent: false, modded: false }
    }

    /// `"<chain>"` plays notes as they come; `"<chain>,<p0>,<p1>,…"` is a drum
    /// rack, note `36 + i` playing `p_i`. Returns the chain being left when the
    /// chain changes with a wheel off rest, so the caller can reset it there.
    /// Malformed input changes nothing.
    pub fn set_map(&mut self, val: &str) -> Result<Option<usize>, ()> {
        let mut it = val.split(',');
        let chain: i32 = it.next().and_then(|s| s.trim().parse().ok()).ok_or(())?;
        let mut map = [-1i16; 128];
        let mut drum = false;
        for (i, s) in it.enumerate() {
            drum = true;
            let p: i16 = s.trim().parse().map_err(|_| ())?;
            if DRUM_BASE + i < 128 && (0..128).contains(&p) {
                map[DRUM_BASE + i] = p;
            }
        }
        if !drum {
            for (i, m) in map.iter_mut().enumerate() {
                *m = i as i16;
            }
        }
        self.map = map;
        let left = if chain != self.chain && self.chain >= 0 && (self.bent || self.modded) {
            Some(self.chain as usize)
        } else {
            None
        };
        if chain != self.chain {
            self.bent = false;
            self.modded = false;
        }
        self.chain = chain;
        Ok(left)
    }

    /// One cable-2 message: `emit(chain, msg)` for each message to play.
    pub fn route(&mut self, status: u8, d1: u8, d2: u8, mut emit: impl FnMut(usize, [u8; 3])) {
        let note = (d1 & 0x7F) as usize;
        let chain = usize::try_from(self.chain).ok();
        match status & 0xF0 {
            0x90 if d2 > 0 => {
                let (Some(chain), Ok(pitch)) = (chain, u8::try_from(self.map[note])) else { return };
                /* A retrigger before the off: close the first note, or it would
                 * be orphaned when its ledger slot is overwritten. */
                if let Some((c, p)) = self.held[note].replace((chain, pitch)) {
                    emit(c, [0x80, p, 0]);
                }
                emit(chain, [0x90, pitch, d2]);
            }
            0x80 | 0x90 => {
                if let Some((c, p)) = self.held[note].take() {
                    emit(c, [0x80, p, 0]);
                }
            }
            0xB0 if d1 == 1 => {
                let Some(chain) = chain else { return };
                self.modded = d2 != 0;
                emit(chain, [0xB0, 1, d2]);
            }
            0xE0 => {
                let Some(chain) = chain else { return };
                self.bent = !(d1 == 0 && d2 == 0x40);
                emit(chain, [0xE0, d1, d2]);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play(r: &mut ExtRoute, status: u8, d1: u8, d2: u8) -> Vec<(usize, [u8; 3])> {
        let mut out = Vec::new();
        r.route(status, d1, d2, |c, m| out.push((c, m)));
        out
    }

    #[test]
    fn melodic_passes_any_channel_to_channel_one() {
        let mut r = ExtRoute::new();
        assert!(play(&mut r, 0x90, 60, 100).is_empty(), "no map yet: silent");
        r.set_map("3").unwrap();
        assert_eq!(play(&mut r, 0x95, 60, 100), [(3, [0x90, 60, 100])]);
        assert_eq!(play(&mut r, 0x85, 60, 0), [(3, [0x80, 60, 0])]);
        assert!(play(&mut r, 0x85, 60, 0).is_empty(), "off for nothing held");
        r.set_map("-1").unwrap();
        assert!(play(&mut r, 0x90, 60, 100).is_empty(), "no chain: silent");
    }

    #[test]
    fn drum_maps_one_key_per_pad_from_36() {
        let mut r = ExtRoute::new();
        r.set_map("2,36,38,42").unwrap();
        assert_eq!(play(&mut r, 0x90, 37, 90), [(2, [0x90, 38, 90])]);
        assert_eq!(play(&mut r, 0x90, 38, 90), [(2, [0x90, 42, 90])]);
        assert!(play(&mut r, 0x90, 39, 90).is_empty(), "past the last pad");
        assert!(play(&mut r, 0x90, 35, 90).is_empty(), "below the first pad");
    }

    #[test]
    fn off_follows_the_ledger_across_a_track_switch() {
        let mut r = ExtRoute::new();
        r.set_map("1").unwrap();
        play(&mut r, 0x90, 60, 100);
        r.set_map("4,36").unwrap();
        assert_eq!(play(&mut r, 0x90, 60, 0), [(1, [0x80, 60, 0])], "vel-0 on is an off");
    }

    #[test]
    fn retrigger_closes_then_plays() {
        let mut r = ExtRoute::new();
        r.set_map("1").unwrap();
        play(&mut r, 0x90, 60, 100);
        r.set_map("2").unwrap();
        assert_eq!(play(&mut r, 0x90, 60, 90), [(1, [0x80, 60, 0]), (2, [0x90, 60, 90])]);
        assert_eq!(play(&mut r, 0x80, 60, 0), [(2, [0x80, 60, 0])]);
    }

    #[test]
    fn wheels_reset_on_the_chain_being_left() {
        let mut r = ExtRoute::new();
        r.set_map("1").unwrap();
        assert_eq!(r.set_map("2").unwrap(), None, "nothing moved");
        assert_eq!(play(&mut r, 0xE0, 0, 0x60), [(2, [0xE0, 0, 0x60])]);
        assert_eq!(r.set_map("2").unwrap(), None, "same chain");
        assert_eq!(r.set_map("5").unwrap(), Some(2));
        assert_eq!(r.set_map("1").unwrap(), None, "reset is per chain");
        play(&mut r, 0xB0, 1, 64);
        play(&mut r, 0xB0, 1, 0);
        assert_eq!(r.set_map("2").unwrap(), None, "wheel back at rest");
        assert!(play(&mut r, 0xB0, 7, 64).is_empty(), "other CCs ignored");
    }

    #[test]
    fn malformed_map_changes_nothing() {
        let mut r = ExtRoute::new();
        r.set_map("1").unwrap();
        assert!(r.set_map("x").is_err());
        assert!(r.set_map("2,a").is_err());
        assert_eq!(play(&mut r, 0x90, 60, 1), [(1, [0x90, 60, 1])]);
    }
}
