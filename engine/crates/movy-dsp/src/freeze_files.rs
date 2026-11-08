//! Freeze on disk (plans/2026-11-08-freeze-all-clips-design.md): which
//! tracks of a Set are frozen, and each frozen clip's loop as a WAV.
//!
//! **Saver thread only.** Nothing here may run on the audio thread: reading a
//! frozen loop back is megabytes of file I/O, and so is its waveform overview.
//!
//! Layout, inside the Set's directory:
//!
//! ```text
//! freeze.txt           the manifest
//! freeze/t<T>-s<S>.wav track T's loop of clip slot S: PCM, 16-bit, stereo
//! ```
//!
//! The manifest's first line is `movy-freeze 3`; then per frozen track
//! `T <track> <bpm_x100> <rate> <chain_print> <modules>` and per clip
//! `C <track> <slot> <len_ticks> <frames> <win_start> <win_len> <clip_print>`:
//! `<len_ticks>` is the loop in CLOCK ticks, `<win_*>` the clip window it was
//! recorded over (CLIP ticks), `<clip_print>` that clip's fingerprint
//! (seq-core `clip_fingerprint`, which leaves the window out), `<chain_print>`
//! the chain's saved settings (`chain_print`) and `<modules>` its
//! `component=module` list. An open freezes a track only when the chain and
//! every clip still match and each clip's window lies inside the recorded one
//! — a version restore whose sound or clips differ opens live (user: "just
//! don't restore a wrong WAV"). An older manifest is no manifest.
//!
//! Every write rewrites the manifest whole and deletes any `freeze/*.wav` it
//! no longer names, so an unfreeze needs no file job of its own.

use crate::freeze::{peaks, LoopMap};
use crate::set_store::{ensure_dir, FILE_MODE};
use seq_core::engine::RecWindow;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;

const MAGIC: &str = "movy-freeze 3";
pub const MANIFEST: &str = "freeze.txt";
const DIR: &str = "freeze";
/// Columns of a loop's waveform overview (the screen is 128 wide; a cut
/// window still has enough of them).
pub const PEAK_COLS: usize = 256;

/// One frozen clip, as the manifest records it.
#[derive(Clone, Debug, PartialEq)]
pub struct ClipEntry {
    pub slot: usize,
    pub len_ticks: u32,
    pub frames: usize,
    pub win: RecWindow,
    pub print: u64,
}

/// One frozen track.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub track: usize,
    pub bpm_x100: u32,
    pub rate: u32,
    pub chain_print: u64,
    pub modules: String,
    pub clips: Vec<ClipEntry>,
}

/// A frozen clip read back from disk.
pub struct FrozenClip {
    pub slot: usize,
    pub map: LoopMap,
    pub samples: Vec<i16>,
    pub win: RecWindow,
    pub print: u64,
    pub peaks: Vec<u8>,
}

/// A frozen track read back from disk, for the audio thread to install.
pub struct FrozenLoad {
    pub track: usize,
    pub chain_print: u64,
    pub modules: String,
    pub clips: Vec<FrozenClip>,
}

/// A loop to write: track, slot, samples (the player's own, shared), rate.
pub type Wav = (usize, usize, Arc<Vec<i16>>, u32);

fn wav_name(track: usize, slot: usize) -> String {
    format!("t{track}-s{slot}.wav")
}

/// A chain's saved settings as one number: FNV-1a over its `get_param`
/// pairs (preset states and LFOs), sorted, empty values left out — the same
/// whether taken from the live snapshot or read back from `chains.json`.
pub fn chain_print(pairs: &[(String, String)]) -> u64 {
    let mut v: Vec<&(String, String)> = pairs.iter().filter(|(_, v)| !v.is_empty()).collect();
    v.sort();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for (k, val) in v {
        for b in k.bytes().chain([0]).chain(val.bytes()).chain([0]) {
            h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
        }
    }
    h
}

pub fn encode_manifest(entries: &[Entry]) -> String {
    let mut s = format!("{MAGIC}\n");
    for e in entries {
        s.push_str(&format!("T {} {} {} {:x} {}\n", e.track, e.bpm_x100, e.rate, e.chain_print, e.modules));
        for c in &e.clips {
            s.push_str(&format!("C {} {} {} {} {} {} {:x}\n", e.track, c.slot, c.len_ticks, c.frames,
                                c.win.start_ticks, c.win.len_ticks, c.print));
        }
    }
    s
}

fn parse_track(f: &[&str], track: usize) -> Option<Entry> {
    if f.len() != 6 || f[5].is_empty() {
        return None;
    }
    Some(Entry { track, bpm_x100: f[2].parse().ok()?, rate: f[3].parse().ok()?,
                 chain_print: u64::from_str_radix(f[4], 16).ok()?, modules: f[5].to_string(), clips: Vec::new() })
}

fn parse_clip(f: &[&str]) -> Option<ClipEntry> {
    if f.len() != 8 {
        return None;
    }
    Some(ClipEntry { slot: f[2].parse().ok()?, len_ticks: f[3].parse().ok()?, frames: f[4].parse().ok()?,
                     win: RecWindow { start_ticks: f[5].parse().ok()?, len_ticks: f[6].parse().ok()? },
                     print: u64::from_str_radix(f[7], 16).ok()? })
}

/// The entries of a manifest. A wrong header is no manifest at all; a line
/// that does not parse costs its track (it opens live), never the others.
pub fn parse_manifest(s: &str) -> Vec<Entry> {
    let mut lines = s.lines();
    if lines.next() != Some(MAGIC) {
        return Vec::new();
    }
    let mut out: Vec<Entry> = Vec::new();
    let mut bad: Vec<usize> = Vec::new();
    for l in lines {
        let f: Vec<&str> = l.split(' ').collect();
        let Some(track) = f.get(1).and_then(|t| t.parse::<usize>().ok()) else { continue };
        match f[0] {
            "T" => match parse_track(&f, track) {
                Some(e) => out.push(e),
                None => bad.push(track),
            },
            "C" => match (parse_clip(&f), out.iter_mut().find(|e| e.track == track)) {
                (Some(c), Some(e)) => e.clips.push(c),
                _ => bad.push(track),
            },
            _ => {}
        }
    }
    out.retain(|e| !bad.contains(&e.track) && !e.clips.is_empty());
    out
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

/// Write a Set's freeze state: the loops of a track just frozen, then the
/// manifest, then drop every WAV the manifest no longer names. The WAVs go
/// first: a manifest never names a loop that is not on disk yet. Returns each
/// written loop's waveform overview `(track, slot, peaks)`, computed here.
pub fn write(set_dir: &Path, manifest: &str, wavs: &[Wav]) -> Result<Vec<(usize, usize, Vec<u8>)>, String> {
    let dir = set_dir.join(DIR);
    ensure_dir(&dir)?;
    let mut out = Vec::new();
    for (track, slot, samples, rate) in wavs {
        atomic_write_bytes(&dir.join(wav_name(*track, *slot)), &encode_wav(samples, *rate))?;
        out.push((*track, *slot, peaks(samples, PEAK_COLS)));
    }
    atomic_write_bytes(&set_dir.join(MANIFEST), manifest.as_bytes())?;
    let keep: Vec<String> = parse_manifest(manifest).iter()
        .flat_map(|e| e.clips.iter().map(move |c| wav_name(e.track, c.slot))).collect();
    if let Ok(rd) = fs::read_dir(&dir) {
        for f in rd.flatten() {
            let name = f.file_name().to_string_lossy().into_owned();
            if name.ends_with(".wav") && !keep.contains(&name) {
                let _ = fs::remove_file(f.path());
            }
        }
    }
    Ok(out)
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
        for c in &e.clips {
            let name = wav_name(e.track, c.slot);
            let _ = fs::copy(src_dir.join(DIR).join(&name), dst_dir.join(DIR).join(&name));
        }
    }
    let _ = atomic_write_bytes(&dst_dir.join(MANIFEST), manifest.as_bytes());
}

/// Every frozen track of a Set whose loops all read back exactly as the
/// manifest describes them. A track with any clip that does not — a missing
/// or foreign WAV, a frame count that disagrees, a map that cannot be rebuilt
/// — is left out whole, and opens live with its chain: never a wrong or
/// truncated loop, never half a frozen track.
pub fn read(set_dir: &Path) -> Vec<FrozenLoad> {
    let Ok(manifest) = fs::read_to_string(set_dir.join(MANIFEST)) else { return Vec::new() };
    parse_manifest(&manifest).into_iter().filter_map(|e| {
        let clips = e.clips.iter().map(|c| {
            let bytes = fs::read(set_dir.join(DIR).join(wav_name(e.track, c.slot))).ok()?;
            let (rate, samples) = decode_wav(&bytes)?;
            let map = LoopMap::new(c.len_ticks, e.bpm_x100, e.rate)?;
            if rate != e.rate || map.frames() != c.frames || samples.len() != c.frames * 2 {
                return None;
            }
            let peaks = peaks(&samples, PEAK_COLS);
            Some(FrozenClip { slot: c.slot, map, samples, win: c.win, print: c.print, peaks })
        }).collect::<Option<Vec<_>>>()?;
        Some(FrozenLoad { track: e.track, chain_print: e.chain_print, modules: e.modules, clips })
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

    fn bar() -> LoopMap {
        LoopMap::new(TICKS_PER_BAR, 12_000, 44_100).unwrap()
    }

    fn entry(track: usize, slots: &[usize]) -> Entry {
        let m = bar();
        Entry { track, bpm_x100: 12_000, rate: 44_100, chain_print: 0xc0ffee, modules: "synth=obxd,fx1=mverb".into(),
                clips: slots.iter().map(|&slot| ClipEntry { slot, len_ticks: m.len_ticks(), frames: m.frames(),
                    win: RecWindow { start_ticks: 0, len_ticks: TICKS_PER_BAR }, print: 0xfeed + slot as u64 }).collect() }
    }

    fn wav(track: usize, slot: usize, v: i16) -> Wav {
        (track, slot, Arc::new(vec![v; bar().frames() * 2]), 44_100)
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
    fn manifest_v3_round_trips() {
        let e = vec![entry(3, &[0, 2, 5]), entry(11, &[1])];
        assert_eq!(parse_manifest(&encode_manifest(&e)), e);
        let mangled = encode_manifest(&e).replace("C 11 1 ", "C 11 x ");
        assert_eq!(parse_manifest(&mangled), vec![e[0].clone()], "a bad clip line costs its track only");
        assert!(parse_manifest("movy-freeze 2\n3 384 12000 44100 88200 0 feed synth=x\n").is_empty(), "v2 is no manifest");
    }

    #[test]
    fn the_chain_print_ignores_order_and_empty_values() {
        let a = vec![("synth:state".to_string(), "blob".to_string()), ("lfo1:rate".to_string(), "3".to_string())];
        let mut b = a.clone();
        b.reverse();
        b.push(("lfo2:rate".to_string(), String::new()));
        assert_eq!(chain_print(&a), chain_print(&b));
        let c = vec![("synth:state".to_string(), "other".to_string())];
        assert_ne!(chain_print(&a), chain_print(&c));
    }

    #[test]
    fn write_then_read_brings_every_loop_back_and_unfreeze_cleans_up() {
        let dir = tmpdir("rt");
        let p = write(&dir, &encode_manifest(&[entry(5, &[0, 3])]), &[wav(5, 0, 100), wav(5, 3, 300)]).unwrap();
        assert_eq!(p.iter().map(|x| (x.0, x.1, x.2.len())).collect::<Vec<_>>(), vec![(5, 0, PEAK_COLS), (5, 3, PEAK_COLS)]);
        let back = read(&dir);
        assert_eq!(back.len(), 1);
        assert_eq!((back[0].track, back[0].modules.as_str(), back[0].chain_print), (5, "synth=obxd,fx1=mverb", 0xc0ffee));
        assert_eq!(back[0].clips.iter().map(|c| (c.slot, c.samples[0])).collect::<Vec<_>>(), vec![(0, 100), (3, 300)]);
        assert_eq!(back[0].clips[1].peaks.len(), PEAK_COLS);
        write(&dir, &encode_manifest(&[]), &[]).unwrap();
        assert!(read(&dir).is_empty());
        assert!(!dir.join("freeze/t5-s3.wav").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_track_with_one_bad_loop_is_not_loaded() {
        let dir = tmpdir("bad");
        let short = (2, 1, Arc::new(vec![0i16; bar().frames() * 2 - 2]), 44_100);
        write(&dir, &encode_manifest(&[entry(2, &[0, 1])]), &[wav(2, 0, 1), short]).unwrap();
        assert!(read(&dir).is_empty(), "a frame short: the track opens live");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_copy_carries_the_loops_and_never_overwrites() {
        let src = tmpdir("cpsrc");
        let dst = tmpdir("cpdst");
        write(&src, &encode_manifest(&[entry(1, &[0, 4])]), &[wav(1, 0, 9), wav(1, 4, 9)]).unwrap();
        copy(&src, &dst);
        assert_eq!(read(&dst).len(), 1, "the duplicate opens frozen too");
        write(&dst, &encode_manifest(&[]), &[]).unwrap();
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
