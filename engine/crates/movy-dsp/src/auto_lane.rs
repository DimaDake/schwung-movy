//! What an automation lane drives, decided when the lane is BOUND.
//!
//! A lane used to be a CC (102+lane) that the chain resolved through its knob
//! mapping and its 256-entry param table, and a key missing from that table
//! was dropped in silence (`chain_midi.c`: `if (!pinfo) return;`). A lane now
//! writes its param straight through the chain's `set_param`, which needs no
//! table, so the target and the value's wire form are fixed here, once, at
//! bind time — the audio thread only formats a number into a stack buffer.
//!
//! Wire form of `ch<N>:lane` (`|`-separated, because option names may hold
//! commas):
//!
//! ```text
//! <lane>|-                          release
//! <lane>|m|<field>                  movy's mixer (gain, pan, send<n>)
//! <lane>|f|<min>|<max>|<comp:key>   float, linear over [min, max]
//! <lane>|i|<min>|<max>|<comp:key>   int, rounded
//! <lane>|e|<n>|<comp:key>           enum written as its index
//! <lane>|n|<comp:key>|<opt>|<opt>…  enum written as its option name
//! ```
//!
//! Enums are equal bins over the 7-bit lane (option = ⌊v·n/128⌋), never
//! interpolated; the UI's held-step detent lands on the same bins.

use core::fmt::Write;
use std::ffi::{CStr, CString};

use crate::mixer::MixField;

/// Automation lanes per track — the engine's, so the two cannot disagree.
pub const AUTO_LANES: usize = seq_core::track::LANES;

#[derive(Debug, PartialEq)]
pub enum LaneFmt {
    Float { min: f64, max: f64 },
    Int { min: f64, max: f64 },
    EnumIndex { n: u16 },
    EnumName { names: Vec<CString> },
}

#[derive(Debug, PartialEq)]
pub struct ParamLane {
    /// `<component>:<key>`, built once so the write allocates nothing.
    pub key: CString,
    pub fmt: LaneFmt,
}

#[derive(Debug, Default, PartialEq)]
pub enum LaneTarget {
    #[default]
    None,
    Mix(MixField),
    Param(ParamLane),
}

/// `<lane>|<spec>` → the lane and what it should drive. `None` for anything
/// malformed, so a bad bind changes nothing rather than half-binding a lane.
pub fn parse(val: &str) -> Option<(usize, LaneTarget)> {
    let mut it = val.split('|');
    let lane: usize = it.next()?.trim().parse().ok()?;
    if lane >= AUTO_LANES {
        return None;
    }
    let num = |s: Option<&str>| -> Option<f64> {
        s?.trim().parse::<f64>().ok().filter(|v| v.is_finite())
    };
    let key = |s: Option<&str>| -> Option<CString> {
        let s = s?;
        // A component and a param, both non-empty: anything else is not a key
        // the chain could route, and binding it would be a silent no-op.
        let (c, k) = s.split_once(':')?;
        if c.is_empty() || k.is_empty() {
            return None;
        }
        CString::new(s).ok()
    };
    let target = match it.next()? {
        "-" => LaneTarget::None,
        "m" => LaneTarget::Mix(MixField::parse(it.next()?.trim())?),
        t @ ("f" | "i") => {
            let (min, max) = (num(it.next())?, num(it.next())?);
            let key = key(it.next())?;
            let fmt = if t == "f" { LaneFmt::Float { min, max } } else { LaneFmt::Int { min, max } };
            LaneTarget::Param(ParamLane { key, fmt })
        }
        "e" => {
            let n: u16 = it.next()?.trim().parse().ok().filter(|&n| n >= 1)?;
            LaneTarget::Param(ParamLane { key: key(it.next())?, fmt: LaneFmt::EnumIndex { n } })
        }
        "n" => {
            let key = key(it.next())?;
            let names: Vec<CString> = it.map(CString::new).collect::<Result<_, _>>().ok()?;
            if names.is_empty() {
                return None;
            }
            LaneTarget::Param(ParamLane { key, fmt: LaneFmt::EnumName { names } })
        }
        _ => return None,
    };
    Some((lane, target))
}

/// Equal bins over the 7-bit lane: the same option for every value in a bin.
pub fn enum_bin(v: u8, n: usize) -> usize {
    ((v.min(127) as usize) * n / 128).min(n.saturating_sub(1))
}

/// A NUL-terminated value, formatted on the stack — the audio thread must not
/// allocate. 32 bytes holds any `{:.4}` of a float this side of 1e20.
pub struct ValBuf {
    buf: [u8; 32],
    len: usize,
}

impl ValBuf {
    pub fn new() -> Self {
        ValBuf { buf: [0; 32], len: 0 }
    }

    pub fn as_cstr(&self) -> Option<&CStr> {
        CStr::from_bytes_with_nul(&self.buf[..=self.len]).ok()
    }
}

impl Default for ValBuf {
    fn default() -> Self {
        Self::new()
    }
}

impl Write for ValBuf {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        // One byte is always kept for the NUL.
        let end = self.len + s.len();
        if end >= self.buf.len() {
            return Err(core::fmt::Error);
        }
        self.buf[self.len..end].copy_from_slice(s.as_bytes());
        self.len = end;
        self.buf[end] = 0;
        Ok(())
    }
}

impl LaneFmt {
    /// The value the lane writes for 7-bit `v`, or None when this format names
    /// a string it already owns (`EnumName`) — the caller passes that directly.
    ///
    /// Float and int use the UI's `denorm7` exactly (`min + v/127·(max−min)`),
    /// so the value written is the value the held arc draws.
    pub fn format(&self, v: u8, out: &mut ValBuf) -> bool {
        let n = v.min(127) as f64 / 127.0;
        let r = match *self {
            LaneFmt::Float { min, max } => write!(out, "{:.4}", min + n * (max - min)),
            LaneFmt::Int { min, max } => {
                let x = (min + n * (max - min)).round().clamp(min.min(max), min.max(max));
                write!(out, "{}", x as i64)
            }
            LaneFmt::EnumIndex { n } => write!(out, "{}", enum_bin(v, n as usize)),
            LaneFmt::EnumName { .. } => return false,
        };
        r.is_ok()
    }

    pub fn name(&self, v: u8) -> Option<&CStr> {
        match self {
            LaneFmt::EnumName { names } => names.get(enum_bin(v, names.len())).map(|c| c.as_c_str()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(spec: &str, v: u8) -> String {
        let Some((_, LaneTarget::Param(p))) = parse(spec) else { panic!("{spec}") };
        if let Some(n) = p.fmt.name(v) {
            return n.to_str().unwrap().to_string();
        }
        let mut b = ValBuf::new();
        assert!(p.fmt.format(v, &mut b));
        b.as_cstr().unwrap().to_str().unwrap().to_string()
    }

    #[test]
    fn every_form_parses_to_its_target() {
        assert_eq!(parse("3|-"), Some((3, LaneTarget::None)));
        assert_eq!(parse("0|m|send2"), Some((0, LaneTarget::Mix(MixField::Send(1)))));
        let Some((31, LaneTarget::Param(p))) = parse("31|f|20|20000|synth:cutoff") else { panic!() };
        assert_eq!(p.key.to_str().unwrap(), "synth:cutoff");
        assert_eq!(p.fmt, LaneFmt::Float { min: 20.0, max: 20000.0 });
    }

    #[test]
    fn a_malformed_bind_is_refused_whole() {
        for bad in ["", "x|-", "32|-", "0|f|0|1", "0|f|0|1|cutoff", "0|f|a|1|synth:x",
                    "0|e|0|synth:x", "0|n|synth:x", "0|m|send9", "0|q|synth:x", "0|i|0|1|:x"] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn values_match_the_ui_denorm_and_the_enum_bins() {
        assert_eq!(written("0|f|0|1|synth:a", 0), "0.0000");
        assert_eq!(written("0|f|0|1|synth:a", 127), "1.0000");
        assert_eq!(written("0|f|-12|12|synth:a", 64), format!("{:.4}", -12.0 + 64.0 / 127.0 * 24.0));
        assert_eq!(written("0|i|0|10|synth:a", 64), "5");
        assert_eq!(written("0|i|0|10|synth:a", 127), "10");
        // A boolean is two equal bins: 0-63 off, 64-127 on.
        assert_eq!(written("0|e|2|synth:a", 63), "0");
        assert_eq!(written("0|e|2|synth:a", 64), "1");
        assert_eq!(written("0|e|3|synth:a", 127), "2");
        assert_eq!(written("0|n|synth:a|Saw|Square, wide|Tri", 0), "Saw");
        assert_eq!(written("0|n|synth:a|Saw|Square, wide|Tri", 50), "Square, wide");
        assert_eq!(written("0|n|synth:a|Saw|Square, wide|Tri", 127), "Tri");
    }

    #[test]
    fn every_bin_is_reachable_and_ordered() {
        for n in 1..=64usize {
            let bins: Vec<usize> = (0..=127u8).map(|v| enum_bin(v, n)).collect();
            assert_eq!(bins[0], 0);
            assert_eq!(*bins.last().unwrap(), n - 1);
            assert!(bins.windows(2).all(|w| w[1] == w[0] || w[1] == w[0] + 1), "n={n}");
        }
    }

    #[test]
    fn an_oversized_value_is_refused_not_truncated() {
        let mut b = ValBuf::new();
        assert!(!LaneFmt::Float { min: 0.0, max: 1e30 }.format(127, &mut b));
    }
}
