//! The chain set as one document.
//!
//! A set's chains used to cross the wire as one param write per component, each
//! a blocking write with its own timeout, none of them acknowledged. The shim
//! services those writes on the audio thread — the same thread that runs a
//! chain load's blocking `dlopen` — so a write issued while an earlier load was
//! still opening could not be serviced, returned false, and was thrown away by
//! a caller that never looked. The set then shrank on disk, because the save
//! read back whatever had actually loaded.
//!
//! So the whole set travels as ONE message that can be acknowledged and
//! retried. The format is the length-prefixed one the shim's bulk channel
//! already speaks (`<count>\n<len>\n<bytes>...`), as flat triples of
//! slot / component / module: `movy-dsp` has no serde, and this needs no
//! escaping, so a module id containing anything at all survives the trip.

/// One component of one chain: "chain 4's synth is noisemaker".
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub slot: usize,
    pub component: String,
    pub module: String,
}

/// Read one length-prefixed item, advancing `p`. `None` on a malformed payload.
fn next_item(s: &[u8], p: &mut usize) -> Option<String> {
    let start = *p;
    let mut nl = None;
    for i in start..s.len() {
        if s[i] == b'\n' {
            nl = Some(i);
            break;
        }
    }
    let nl = nl?;
    let len: usize = std::str::from_utf8(&s[start..nl]).ok()?.parse().ok()?;
    let from = nl + 1;
    let to = from.checked_add(len)?;
    if to > s.len() {
        return None;
    }
    *p = to;
    Some(String::from_utf8_lossy(&s[from..to]).into_owned())
}

/// Parse a document. `None` — not an empty list — when the payload is
/// malformed: a truncated document read as "no chains" would clear the set.
pub fn decode(doc: &str) -> Option<Vec<Entry>> {
    let s = doc.as_bytes();
    let nl = s.iter().position(|&c| c == b'\n')?;
    let count: usize = std::str::from_utf8(&s[..nl]).ok()?.parse().ok()?;
    if count % 3 != 0 {
        return None;
    }
    let mut p = nl + 1;
    let mut out = Vec::with_capacity(count / 3);
    for _ in 0..count / 3 {
        let slot: usize = next_item(s, &mut p)?.parse().ok()?;
        let component = next_item(s, &mut p)?;
        let module = next_item(s, &mut p)?;
        /* An entry that names no module is not an entry — the empty string is
         * the teardown value, and a document says what IS loaded. */
        if component.is_empty() || module.is_empty() {
            continue;
        }
        out.push(Entry { slot, component, module });
    }
    Some(out)
}

pub fn encode(entries: &[Entry]) -> String {
    let mut out = String::with_capacity(entries.len() * 32 + 8);
    out.push_str(&(entries.len() * 3).to_string());
    out.push('\n');
    for e in entries {
        for field in [e.slot.to_string(), e.component.clone(), e.module.clone()] {
            out.push_str(&field.len().to_string());
            out.push('\n');
            out.push_str(&field);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(slot: usize, component: &str, module: &str) -> Entry {
        Entry { slot, component: component.into(), module: module.into() }
    }

    #[test]
    fn round_trips() {
        let set = vec![e(0, "synth", "noisemaker"), e(4, "fx1", "mverb")];
        assert_eq!(decode(&encode(&set)), Some(set));
    }

    #[test]
    fn an_empty_set_is_a_valid_document() {
        assert_eq!(decode(&encode(&[])), Some(vec![]));
        assert_eq!(encode(&[]), "0\n");
    }

    #[test]
    fn lengths_are_the_framing_not_delimiters() {
        // A module id is a filename today, but the format must not depend on
        // that: nothing here may be delimiter-sensitive.
        let set = vec![e(2, "synth", "we\nird")];
        assert_eq!(decode(&encode(&set)), Some(set));
    }

    #[test]
    fn a_malformed_document_is_refused_whole() {
        // Refused, NOT read as an empty set: an empty set is an instruction to
        // unload everything, so a truncated write must never decode as one.
        assert_eq!(decode(""), None);
        assert_eq!(decode("garbage"), None);
        assert_eq!(decode("3\n1\n4"), None, "truncated item");
        assert_eq!(decode("2\n1\n4\n5\nsynth"), None, "count is not a whole number of triples");
        assert_eq!(decode("3\n\n4\n5\nsynth\n1\nx"), None, "empty length field");
    }

    #[test]
    fn an_entry_with_no_module_is_not_an_entry() {
        let doc = encode(&[e(1, "synth", ""), e(2, "synth", "plaits")]);
        assert_eq!(decode(&doc), Some(vec![e(2, "synth", "plaits")]));
    }
}
