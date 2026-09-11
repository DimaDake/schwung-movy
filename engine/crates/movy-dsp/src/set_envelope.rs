//! The on-disk envelope around the engine's own state serialization.
//!
//! A direct port of `src/seq/persist-blob.ts`, and it must stay one: a Set
//! written by either half has to be readable by the other, on a device whose
//! movy may be older than its Sets.
//!
//!   movy1                       <- unchanged, so old builds still load us
//!   gen 42                      <- generation, at the TOP so truncation keeps it
//!   ...engine payload...
//!   end 42 1850 2a1f3c04        <- generation, payload length, adler32
//!
//! `gen` and `end` are unknown verbs to seq_core::persist::load, which ignores
//! them. Splitting the marker from the checksum is what makes a truncation deep
//! in the payload distinguishable from a pre-envelope file: without it, both
//! look like a file that simply never had an envelope.

pub const TAG: &str = "movy1";
pub const BLANK_STATE: &str = "movy1\n";

pub struct Parsed {
    pub payload: String,
    pub gen: u32,
    /// No envelope: written by a build that predates it. Generations cannot
    /// order it against enveloped copies, so the reader needs to know.
    pub legacy: bool,
}

/// Adler-32 over the low byte of each char, matching the TypeScript exactly.
pub fn adler32(s: &str) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for ch in s.chars() {
        a = (a + (ch as u32 & 0xff)) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

pub fn wrap(payload: &str, gen: u32) -> String {
    let owned;
    let p: &str = if payload.ends_with('\n') {
        payload
    } else {
        owned = format!("{payload}\n");
        &owned
    };
    let rest = match p.find('\n') {
        Some(i) => &p[i + 1..],
        None => "",
    };
    format!("{TAG}\ngen {gen}\n{rest}end {gen} {} {}\n", p.len(), adler32(p))
}

pub fn parse(raw: &str) -> Option<Parsed> {
    let lines: Vec<&str> = raw.split('\n').collect();
    if lines.first()?.trim() != TAG {
        return None;
    }

    // No generation marker -> written before the envelope existed. Trust it:
    // that is the only shape every currently-installed build produces.
    let second = lines.get(1).copied().unwrap_or("");
    if !second.starts_with("gen ") {
        return Some(Parsed { payload: raw.to_string(), gen: 0, legacy: true });
    }

    let gen: u32 = second[4..].trim().parse().ok()?;

    let mut last = lines.len() - 1;
    while last > 0 && lines[last].is_empty() {
        last -= 1;
    }
    let tr: Vec<&str> = lines[last].split(' ').collect();
    if tr.len() != 4 || tr[0] != "end" || tr[1].parse::<u32>().ok()? != gen {
        return None;
    }

    let body = lines[2..last].join("\n");
    let payload = format!("{TAG}\n{body}{}", if last > 2 { "\n" } else { "" });
    if payload.len() != tr[2].parse::<usize>().ok()? || adler32(&payload) != tr[3].parse().ok()? {
        return None;
    }
    Some(Parsed { payload, gen, legacy: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    /* The exact bytes persist-blob.ts produces. If this test's expectation ever
     * has to change, the format changed, and every movy on every device that
     * has not been updated can no longer read the user's Sets. */
    #[test]
    fn wraps_the_documented_shape() {
        let payload = "movy1\nbpm 12000\n";
        let w = wrap(payload, 42);
        assert!(w.starts_with("movy1\ngen 42\n"), "got {w:?}");
        assert!(w.ends_with(&format!("end 42 {} {}\n", payload.len(), adler32(payload))),
                "got {w:?}");
    }

    #[test]
    fn round_trips() {
        let payload = "movy1\nbpm 12000\ncl 0 0 16 0 0:24:60:100\n";
        let p = parse(&wrap(payload, 7)).expect("parses");
        assert_eq!(p.payload, payload);
        assert_eq!(p.gen, 7);
        assert!(!p.legacy);
    }

    /* A file with no `gen` line predates the envelope. It must parse, as
     * generation 0, and be MARKED legacy — the precedence rule in set_store
     * turns on that flag. */
    #[test]
    fn legacy_file_parses_as_gen_zero() {
        let p = parse("movy1\nbpm 12000\n").expect("parses");
        assert_eq!(p.gen, 0);
        assert!(p.legacy);
        assert_eq!(p.payload, "movy1\nbpm 12000\n");
    }

    /* The whole reason the marker is at the top and the checksum at the bottom:
     * without the split, a truncation deep in the payload is indistinguishable
     * from a pre-envelope file, and a torn write loads as a PARTIAL set. */
    #[test]
    fn torn_write_is_rejected_not_read_as_legacy() {
        let full = wrap("movy1\nbpm 12000\ncl 0 0 16 0 0:24:60:100\n", 9);
        let torn = &full[..full.len() - 12];
        assert!(parse(torn).is_none(), "a torn envelope must not parse");
    }

    #[test]
    fn checksum_mismatch_is_rejected() {
        let w = wrap("movy1\nbpm 12000\n", 3).replace("bpm 12000", "bpm 13000");
        assert!(parse(&w).is_none());
    }

    #[test]
    fn wrong_tag_is_rejected() {
        assert!(parse("notmovy\ngen 1\n").is_none());
        assert!(parse("").is_none());
    }

    /* Ported from persist-blob.ts: the payload is ASCII, and the low byte of
     * each char is the byte value. A fixed vector pins the port. */
    #[test]
    fn adler32_matches_the_typescript() {
        assert_eq!(adler32(""), 1);
        assert_eq!(adler32("movy1\n"), 0x086e0207);
    }

    /* Differential against the REAL persist-blob.ts, not a restatement of it.
     * Vectors generated from dist/esm/seq/persist-blob.js — the code that writes
     * every Set on every device today. A port that merely looks right is how a
     * format quietly forks; the last case has no trailing newline, which
     * wrapState appends before it measures.
     *
     * Regenerate with:
     *   node -e "import('./dist/esm/seq/persist-blob.js').then(m=>console.log(
     *     JSON.stringify(m.wrapState('movy1\\n', 0))))"
     */
    #[test]
    fn matches_the_typescript_byte_for_byte() {
        let cases: [(&str, u32, &str); 5] = [
            ("movy1\n", 0, "movy1\ngen 0\nend 0 6 141427207\n"),
            ("movy1\nbpm 12000\n", 42, "movy1\ngen 42\nbpm 12000\nend 42 16 748291171\n"),
            ("movy1\nbpm 12000\ncl 0 0 16 0 0:24:60:100\n", 7, "movy1\ngen 7\nbpm 12000\ncl 0 0 16 0 0:24:60:100\nend 7 40 3564046606\n"),
            ("movy1\nau 0 0 50 synth:octave_transpose\n", 123456, "movy1\ngen 123456\nau 0 0 50 synth:octave_transpose\nend 123456 39 4223405404\n"),
            ("movy1\nbpm 12000", 3, "movy1\ngen 3\nbpm 12000\nend 3 16 748291171\n"),
        ];
        for (payload, gen, expect) in cases {
            assert_eq!(wrap(payload, gen), expect, "payload {payload:?} gen {gen}");
            let back = parse(expect).expect("our parse reads the TS bytes");
            assert_eq!(back.gen, gen);
        }
    }
}
