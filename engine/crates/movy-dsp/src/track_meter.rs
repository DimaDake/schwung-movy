//! The mixer page's level meters: per track, stereo, post-fader.
//!
//! Folded on the audio thread from the block every chain already rendered, so
//! the UI reads finished numbers out of `status` and never polls a chain. The
//! ballistics live HERE rather than in the UI for that reason: `status` is a
//! pure read published every block (WP10), so the only place a peak can be
//! held and let fall is where the blocks are.

use crate::chain_slots::MOVY_CHAINS;
use crate::mixer::TrackMix;

/// How fast a held peak falls. A console-style release: slow enough that a
/// transient is still visible a frame or two of the UI later, fast enough that
/// a stopped track reads empty within a few seconds.
const DECAY_DB_PER_S: f32 = 20.0;

/// The dB a meter byte's step is worth, and the floor byte 1 stands for.
/// Byte 0 is silence; 1..=255 cover -60 dB .. +67 dB in half-dB steps, which
/// spans a fader at +12 dB driving a full-scale block.
const BYTE_FLOOR_DB: f32 = -60.0;
const BYTE_STEPS_PER_DB: f32 = 2.0;

/// Full scale for an `i16` block, so 0 dB on a meter is a clipping sample.
const FULL_SCALE: f32 = 32767.0;

pub struct TrackMeter {
    /// Linear, 1.0 = full scale, post-fader and post-pan.
    level: [[f32; 2]; MOVY_CHAINS],
}

impl TrackMeter {
    pub fn new() -> Self {
        TrackMeter { level: [[0.0; 2]; MOVY_CHAINS] }
    }

    /// Let every meter fall by one block's worth. Called once per block BEFORE
    /// any fold, so a chain that rendered nothing — unloaded, asleep, idle —
    /// still empties instead of freezing at its last level.
    pub fn decay(&mut self, frames: usize, sample_rate: u32) {
        let secs = frames as f32 / sample_rate.max(1) as f32;
        let k = 10f32.powf(-DECAY_DB_PER_S * secs / 20.0);
        for ch in self.level.iter_mut() {
            ch[0] *= k;
            ch[1] *= k;
        }
    }

    /// Fold one chain's block peaks (pre-fader, 0..32767) through its mix.
    /// The gains are the mix's own (`mix_into` uses the same pair), so mute,
    /// pan and the fader move the meter exactly as they move the sound.
    pub fn fold(&mut self, i: usize, peak_l: i32, peak_r: i32, mix: &TrackMix) {
        let Some(ch) = self.level.get_mut(i) else { return };
        let (gl, gr) = mix.voice_send_gains();
        ch[0] = ch[0].max(peak_l as f32 / FULL_SCALE * gl);
        ch[1] = ch[1].max(peak_r as f32 / FULL_SCALE * gr);
    }

    /// ` mtr=` plus, per track, three hex bytes: fader gain, left, right — the
    /// fader rides along so the page draws without reading a single param.
    pub fn status(&self, mixes: &[TrackMix]) -> String {
        let mut s = String::with_capacity(6 + MOVY_CHAINS * 6);
        s.push_str(" mtr=");
        for i in 0..MOVY_CHAINS {
            let gain = mixes.get(i).map_or(0.0, |m| if m.muted { 0.0 } else { m.gain });
            for v in [gain, self.level[i][0], self.level[i][1]] {
                push_hex(&mut s, db_byte(v));
            }
        }
        s
    }
}

fn push_hex(s: &mut String, b: u8) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    s.push(HEX[(b >> 4) as usize] as char);
    s.push(HEX[(b & 15) as usize] as char);
}

/// A linear amplitude as a meter byte: 0 = silence, else half-dB steps up
/// from -60 dB. Anything below the floor reads as silence rather than as the
/// floor, so a decayed meter actually reaches empty.
pub fn db_byte(amp: f32) -> u8 {
    if !(amp > 0.0) {
        return 0;
    }
    let db = 20.0 * amp.log10();
    if db < BYTE_FLOOR_DB {
        return 0;
    }
    (1.0 + ((db - BYTE_FLOOR_DB) * BYTE_STEPS_PER_DB).round()).min(255.0) as u8
}

/// Left and right abs-max of an interleaved stereo block.
pub fn stereo_peaks(block: &[i16]) -> (i32, i32) {
    let (mut l, mut r) = (0i32, 0i32);
    for f in block.chunks_exact(2) {
        l = l.max((f[0] as i32).abs());
        r = r.max((f[1] as i32).abs());
    }
    (l, r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unity() -> TrackMix {
        TrackMix::default()
    }

    #[test]
    fn byte_encoding_has_landmarks() {
        assert_eq!(db_byte(0.0), 0);
        assert_eq!(db_byte(f32::NAN), 0);
        assert_eq!(db_byte(1e-6), 0, "below the floor is silence, not the floor");
        assert_eq!(db_byte(1.0), 121, "0 dB = 1 + 60*2");
        assert_eq!(db_byte(0.5), 109, "-6 dB = 121 - 6*2");
        assert_eq!(db_byte(4.0), 145, "+12 dB, the fader top");
        assert_eq!(db_byte(1e9), 255);
    }

    #[test]
    fn stereo_peaks_split_channels() {
        assert_eq!(stereo_peaks(&[100, -300, -200, 50]), (200, 300));
        assert_eq!(stereo_peaks(&[i16::MIN, 0]), (32768, 0));
    }

    #[test]
    fn fold_is_post_fader_and_post_pan() {
        let mut m = TrackMeter::new();
        let mut mix = unity();
        mix.gain = 0.5;
        mix.pan = 1.0; // hard right: left gain 0
        m.fold(3, 32767, 32767, &mix);
        assert_eq!(m.level[3][0], 0.0);
        assert!((m.level[3][1] - 0.5).abs() < 1e-4);
    }

    #[test]
    fn muted_track_reads_silent() {
        let mut m = TrackMeter::new();
        let mut mix = unity();
        mix.muted = true;
        m.fold(0, 32767, 32767, &mix);
        assert_eq!(m.level[0], [0.0, 0.0]);
        let s = m.status(&[mix]);
        assert!(s.starts_with(" mtr=000000"), "{s}");
    }

    #[test]
    fn peak_holds_then_falls_at_the_release_rate() {
        let mut m = TrackMeter::new();
        m.fold(1, 32767, 32767, &unity());
        // One second of 128-frame blocks at 44.1 kHz: 20 dB down.
        let blocks = 44_100 / 128;
        for _ in 0..blocks {
            m.decay(128, 44_100);
            m.fold(1, 0, 0, &unity());
        }
        let db = 20.0 * m.level[1][0].log10();
        assert!((db + 20.0).abs() < 0.5, "fell to {db} dB");
        // A louder block wins immediately; a quieter one does not pull it down.
        m.fold(1, 32767, 1000, &unity());
        assert_eq!(m.level[1][0], 1.0);
        assert!(m.level[1][1] > 0.09);
    }

    #[test]
    fn status_carries_every_track() {
        let m = TrackMeter::new();
        let s = m.status(&vec![unity(); MOVY_CHAINS]);
        assert_eq!(s.len(), 5 + MOVY_CHAINS * 6);
        assert!(s.starts_with(" mtr=790000"), "unity fader = byte 121 = 0x79: {s}");
    }
}
