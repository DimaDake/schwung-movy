//! Wire protocol: the UI batches ops into one `set_param("cmd", "op;op;…")`
//! per UI tick (the param channel coalesces — only the last write per audio
//! buffer survives — so ops must travel together). Each op is a short verb
//! plus space-separated integer args. Unknown ops are ignored so old engines
//! tolerate newer UIs.

use crate::engine::{Engine, OutEvent};
use crate::track::NUM_TRACKS;

/// Apply one batched command string. MIDI side effects (e.g. note-offs from
/// a stop) are pushed into `out`.
pub fn apply_batch(engine: &mut Engine, batch: &str, out: &mut Vec<OutEvent>) {
    for op in batch.split(';') {
        let op = op.trim();
        if !op.is_empty() {
            apply_op(engine, op, out);
        }
    }
}

fn apply_op(engine: &mut Engine, op: &str, out: &mut Vec<OutEvent>) {
    let mut it = op.split_whitespace();
    let verb = it.next().unwrap_or("");
    let mut arg = || it.next().and_then(|s| s.parse::<i64>().ok());

    match verb {
        "play" => engine.play(),
        "stop" => engine.stop(out),
        "bpm" => {
            if let Some(v) = arg() {
                engine.clock.set_bpm_x100(v.clamp(0, u32::MAX as i64) as u32);
            }
        }
        "watch" => {
            if let Some(t) = arg() {
                if (t as usize) < NUM_TRACKS {
                    engine.watch_track = t as usize;
                }
            }
        }
        "mute" => {
            if let (Some(t), Some(m)) = (arg(), arg()) {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize].muted = m != 0;
                }
            }
        }
        // tog <track> <step> <pitch> <vel> — native step toggle
        "tog" => {
            if let (Some(t), Some(s), Some(p), Some(v)) = (arg(), arg(), arg(), arg()) {
                if (t as usize) < NUM_TRACKS && (0..128).contains(&p) {
                    let added = engine.tracks[t as usize]
                        .active_mut()
                        .toggle_step(s.clamp(0, 255) as u16, &[(p as u8, v.clamp(1, 127) as u8)]);
                    engine.maybe_autostart(added);
                }
            }
        }
        _ => {} // forward compat
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine::new(44100, 12000)
    }

    #[test]
    fn batch_applies_in_order() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;watch 1;bpm 14000", &mut out);
        assert_eq!(e.tracks[0].active().notes.len(), 1);
        assert_eq!(e.watch_track, 1);
        assert_eq!(e.clock.bpm_x100(), 14000);
    }

    #[test]
    fn tog_autostarts_transport() {
        let mut e = engine();
        let mut out = Vec::new();
        assert!(!e.playing);
        apply_batch(&mut e, "tog 0 4 62 90", &mut out);
        assert!(e.playing, "first note in empty clip must start transport");
        // Toggling the note away does not stop or restart anything.
        apply_batch(&mut e, "tog 0 4 62 90", &mut out);
        assert!(e.playing);
        assert!(e.tracks[0].active().notes.is_empty());
    }

    #[test]
    fn play_stop_roundtrip() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "play", &mut out);
        assert!(e.playing);
        apply_batch(&mut e, "stop", &mut out);
        assert!(!e.playing);
    }

    #[test]
    fn mute_per_track() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "mute 2 1", &mut out);
        assert!(e.tracks[2].muted);
        apply_batch(&mut e, "mute 2 0", &mut out);
        assert!(!e.tracks[2].muted);
    }

    #[test]
    fn malformed_and_unknown_ops_ignored() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0;;frobnicate 1 2 3; ;tog 9 0 60 100;tog 0 0 999 100", &mut out);
        assert!(e.tracks[0].active().notes.is_empty());
        assert!(!e.playing);
    }
}
