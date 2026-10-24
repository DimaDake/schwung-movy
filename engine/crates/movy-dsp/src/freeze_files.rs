//! Freeze on disk (plans/2026-10-23-stems-freeze-export-wifi.md, F3): which
//! tracks of a Set are frozen, and each one's loop as a WAV.
//!
//! **Saver thread only.** Nothing here may run on the audio thread: reading a
//! frozen loop back is megabytes of file I/O.
//!
//! Layout, inside the Set's directory:
//!
//! ```text
//! freeze.txt         the manifest
//! freeze/t<N>.wav    track N's loop: PCM, 16-bit, stereo, at the captured rate
//! ```
//!
//! The manifest's first line is `movy-freeze 1`; then one line per frozen
//! track: `<track> <len_ticks> <bpm_x100> <rate> <frames> <modules>`, where
//! `<modules>` is the chain's `component=module` list joined by commas. An open
//! freezes a track only when the Set's chain still names exactly those modules
//! — a version restore that brought back another sound must not play a loop
//! recorded from this one; it simply opens unfrozen.
//!
//! Every write rewrites the manifest whole and deletes any `freeze/*.wav` it
//! no longer names, so an unfreeze needs no file job of its own.

use crate::freeze::LoopMap;
use crate::set_store::{ensure_dir, FILE_MODE};
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

const MAGIC: &str = "movy-freeze 1";
pub const MANIFEST: &str = "freeze.txt";
const DIR: &str = "freeze";

/// One frozen track, as the manifest records it.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub track: usize,
    pub len_ticks: u32,
    pub bpm_x100: u32,
    pub rate: u32,
    pub frames: usize,
    pub modules: String,
}

/// A frozen track read back from disk, for the audio thread to install.
pub struct FrozenLoad {
    pub track: usize,
    pub map: LoopMap,
    pub samples: Vec<i16>,
    pub modules: String,
}

fn wav_name(track: usize) -> String {
    format!("t{track}.wav")
}

pub fn encode_manifest(entries: &[Entry]) -> String {
    let mut s = format!("{MAGIC}\n");
    for e in entries {
        s.push_str(&format!("{} {} {} {} {} {}\n",
            e.track, e.len_ticks, e.bpm_x100, e.rate, e.frames, e.modules));
    }
    s
}

/// The entries of a manifest. A wrong header is no manifest at all; a line
/// that does not parse is skipped (its track opens unfrozen) without costing
/// the others.
pub fn parse_manifest(s: &str) -> Vec<Entry> {
    let mut lines = s.lines();
    if lines.next() != Some(MAGIC) {
        return Vec::new();
    }
    lines.filter_map(|l| {
        let f: Vec<&str> = l.split(' ').collect();
        if f.len() != 6 || f[5].is_empty() {
            return None;
        }
        Some(Entry {
            track: f[0].parse().ok()?,
            len_ticks: f[1].parse().ok()?,
            bpm_x100: f[2].parse().ok()?,
            rate: f[3].parse().ok()?,
            frames: f[4].parse().ok()?,
            modules: f[5].to_string(),
        })
    }).collect()
}

/// A canonical 44-byte-header PCM WAV: 16-bit, stereo.
pub fn encode_wav(samples: &[i16], rate: u32) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut b = Vec::with_capacity(44 + data as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes()); // PCM
    b.extend_from_slice(&2u16.to_le_bytes()); // stereo
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * 4).to_le_bytes()); // byte rate
    b.extend_from_slice(&4u16.to_le_bytes()); // block align
    b.extend_from_slice(&16u16.to_le_bytes()); // bits
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        b.extend_from_slice(&s.to_le_bytes());
    }
    b
}

fn u16_at(b: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?))
}

/// The rate and samples of a 16-bit stereo PCM WAV; `None` for anything else
/// (another format, a truncated file). Walks the chunks rather than trusting
/// a fixed header, so a file another tool rewrote still reads.
pub fn decode_wav(b: &[u8]) -> Option<(u32, Vec<i16>)> {
    if b.get(0..4)? != b"RIFF" || b.get(8..12)? != b"WAVE" {
        return None;
    }
    let mut i = 12;
    let mut fmt: Option<(u16, u16, u32, u16)> = None;
    while i + 8 <= b.len() {
        let id = &b[i..i + 4];
        let len = u32_at(b, i + 4)? as usize;
        let body = i + 8;
        if id == b"fmt " {
            fmt = Some((u16_at(b, body)?, u16_at(b, body + 2)?, u32_at(b, body + 4)?, u16_at(b, body + 14)?));
        } else if id == b"data" {
            let (format, channels, rate, bits) = fmt?;
            if format != 1 || channels != 2 || bits != 16 {
                return None;
            }
            let data = b.get(body..body.checked_add(len)?)?;
            let samples = data.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
            return Some((rate, samples));
        }
        i = body.checked_add(len + (len & 1))?; // chunks are word-aligned
    }
    None
}

fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("writing");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create {tmp:?}: {e}"))?;
        let _ = f.set_permissions(fs::Permissions::from_mode(FILE_MODE));
        f.write_all(bytes).map_err(|e| format!("write {tmp:?}: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync {tmp:?}: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))
}

/// Write a Set's freeze state: track `wav.0`'s loop when one was just frozen,
/// then the manifest, then drop every WAV the manifest no longer names. The
/// WAV goes first: a manifest never names a loop that is not on disk yet.
pub fn write(set_dir: &Path, manifest: &str, wav: Option<(usize, &[i16], u32)>) -> Result<(), String> {
    let dir = set_dir.join(DIR);
    ensure_dir(&dir)?;
    if let Some((track, samples, rate)) = wav {
        atomic_write_bytes(&dir.join(wav_name(track)), &encode_wav(samples, rate))?;
    }
    atomic_write_bytes(&set_dir.join(MANIFEST), manifest.as_bytes())?;
    let keep: Vec<String> = parse_manifest(manifest).iter().map(|e| wav_name(e.track)).collect();
    if let Ok(rd) = fs::read_dir(&dir) {
        for f in rd.flatten() {
            let name = f.file_name().to_string_lossy().into_owned();
            if name.ends_with(".wav") && !keep.contains(&name) {
                let _ = fs::remove_file(f.path());
            }
        }
    }
    Ok(())
}

/// Copy a Set's freeze files to another Set's directory (`SetStore::seed`:
/// a rename or a duplicate). Nothing when the source has no manifest, or the
/// destination already has one of its own. The WAVs go before the manifest,
/// for the same reason `write` orders them so.
pub fn copy(src_dir: &Path, dst_dir: &Path) {
    let Ok(manifest) = fs::read_to_string(src_dir.join(MANIFEST)) else { return };
    if dst_dir.join(MANIFEST).exists() || ensure_dir(&dst_dir.join(DIR)).is_err() {
        return;
    }
    for e in parse_manifest(&manifest) {
        let name = wav_name(e.track);
        let _ = fs::copy(src_dir.join(DIR).join(&name), dst_dir.join(DIR).join(&name));
    }
    let _ = atomic_write_bytes(&dst_dir.join(MANIFEST), manifest.as_bytes());
}

/// Every frozen track of a Set whose loop reads back exactly as the manifest
/// describes it. Anything that does not — a missing or foreign WAV, a frame
/// count that disagrees, a map that cannot be rebuilt — is left out, and that
/// track opens unfrozen with its chain: never a wrong or truncated loop.
pub fn read(set_dir: &Path) -> Vec<FrozenLoad> {
    let Ok(manifest) = fs::read_to_string(set_dir.join(MANIFEST)) else { return Vec::new() };
    parse_manifest(&manifest).into_iter().filter_map(|e| {
        let bytes = fs::read(set_dir.join(DIR).join(wav_name(e.track))).ok()?;
        let (rate, samples) = decode_wav(&bytes)?;
        let map = LoopMap::new(e.len_ticks, e.bpm_x100, e.rate)?;
        if rate != e.rate || map.frames() != e.frames || samples.len() != e.frames * 2 {
            return None;
        }
        Some(FrozenLoad { track: e.track, map, samples, modules: e.modules })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use seq_core::TICKS_PER_BAR;

    fn tmpdir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("movy-freeze-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn entry(track: usize, map: &LoopMap) -> Entry {
        Entry { track, len_ticks: map.len_ticks(), bpm_x100: map.bpm_x100(), rate: map.sample_rate(),
                frames: map.frames(), modules: "synth=obxd,fx1=mverb".into() }
    }

    #[test]
    fn a_wav_round_trips() {
        let s: Vec<i16> = (0..1000).map(|i| (i * 37 - 18_000) as i16).collect();
        let (rate, back) = decode_wav(&encode_wav(&s, 44_100)).unwrap();
        assert_eq!((rate, back), (44_100, s));
    }

    #[test]
    fn a_foreign_or_broken_wav_is_refused() {
        let mut mono = encode_wav(&[1, 2, 3, 4], 44_100);
        mono[22] = 1; // channels = 1
        assert!(decode_wav(&mono).is_none());
        let full = encode_wav(&[1, 2, 3, 4], 44_100);
        assert!(decode_wav(&full[..full.len() - 2]).is_none(), "truncated data");
        assert!(decode_wav(b"not a wav at all").is_none());
    }

    #[test]
    fn the_manifest_round_trips_and_skips_what_it_cannot_read() {
        let m = LoopMap::new(TICKS_PER_BAR, 12_000, 44_100).unwrap();
        let e = vec![entry(3, &m), entry(11, &m)];
        assert_eq!(parse_manifest(&encode_manifest(&e)), e);
        let mangled = encode_manifest(&e).replace("11 384", "eleven 384");
        assert_eq!(parse_manifest(&mangled), vec![e[0].clone()]);
        assert!(parse_manifest("some other file\n3 384 12000 44100 88200 synth=x\n").is_empty());
    }

    #[test]
    fn write_then_read_brings_the_loop_back_and_unfreeze_cleans_up() {
        let dir = tmpdir("rt");
        let m = LoopMap::new(TICKS_PER_BAR, 12_000, 44_100).unwrap();
        let s: Vec<i16> = (0..m.frames() * 2).map(|i| (i % 3000) as i16).collect();
        write(&dir, &encode_manifest(&[entry(5, &m)]), Some((5, &s, 44_100))).unwrap();
        let back = read(&dir);
        assert_eq!(back.len(), 1);
        assert_eq!((back[0].track, back[0].map, back[0].modules.as_str()), (5, m, "synth=obxd,fx1=mverb"));
        assert_eq!(back[0].samples, s);
        // Unfreeze: the manifest drops the track, and its WAV goes with it.
        write(&dir, &encode_manifest(&[]), None).unwrap();
        assert!(read(&dir).is_empty());
        assert!(!dir.join("freeze/t5.wav").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_loop_that_disagrees_with_its_manifest_is_not_loaded() {
        let dir = tmpdir("bad");
        let m = LoopMap::new(TICKS_PER_BAR, 12_000, 44_100).unwrap();
        let short: Vec<i16> = vec![0; m.frames() * 2 - 2];
        write(&dir, &encode_manifest(&[entry(2, &m)]), Some((2, &short, 44_100))).unwrap();
        assert!(read(&dir).is_empty(), "a frame short: the track opens unfrozen");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_copy_carries_the_loops_and_never_overwrites() {
        let src = tmpdir("cpsrc");
        let dst = tmpdir("cpdst");
        let m = LoopMap::new(TICKS_PER_BAR, 12_000, 44_100).unwrap();
        let s: Vec<i16> = vec![9; m.frames() * 2];
        write(&src, &encode_manifest(&[entry(1, &m)]), Some((1, &s, 44_100))).unwrap();
        copy(&src, &dst);
        assert_eq!(read(&dst).len(), 1, "the duplicate opens frozen too");
        // A destination with its own manifest is left alone.
        write(&dst, &encode_manifest(&[]), None).unwrap();
        copy(&src, &dst);
        assert!(read(&dst).is_empty());
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst);
    }

    #[test]
    fn no_manifest_is_nothing_frozen() {
        let dir = tmpdir("none");
        assert!(read(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
