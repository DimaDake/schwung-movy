//! The whole chain set as one document the engine can write by itself.
//!
//! `chain_doc` carries slot/component/module — what a LOAD needs. This carries
//! what a SAVE needs as well: the module's preset blob and the mixer triple.
//!
//! Those do not ride the state param at all today; they cross schwung's bulk
//! channel, which waits 100 ms and does not retry, serviced on the audio thread
//! that a cold `dlopen` holds for up to 428 ms. `src/track/chain-payload.ts`
//! records the consequence: every payload write timing out, every module coming
//! up at its shipped defaults, and the next capture writing those defaults into
//! the Set file — a patch destroyed, not merely un-restored. The far end of
//! that channel IS this engine, so none of it needs to travel.
//!
//! Same flat length-prefixed codec as `chain_doc` and `src/track/bulk.ts`: no
//! escaping, so a preset blob containing anything at all survives.

use crate::chain_slots::ChainSlots;

const FIELDS: usize = 6;

/* Every field the chain host accepts under `lfoN:`, minus `active`, which it
 * derives from target+param and refuses to be told. The ORDER is the contract:
 * `src/track/lfo-persist.ts:lfoStateKeys()` reads these back positionally, and
 * a reordering here silently writes one LFO's depth into another's rate. */
const LFO_KEYS: [&str; 11] = [
    "enabled", "shape", "sync", "rate_hz", "rate_div",
    "depth", "polarity", "phase_offset", "target", "target_param", "retrigger",
];
const LFO_COUNT: usize = 2;

/// A chain's two LFOs as a nested document, or "" when both are idle.
///
/// Nested rather than joined by a separator because a target name is arbitrary
/// text; the outer field is length-prefixed, so anything at all fits inside it.
/// An untouched chain writes nothing, matching `packLfoState`.
fn lfo_state(slots: &mut ChainSlots, slot: usize) -> String {
    let mut vals: Vec<String> = Vec::with_capacity(LFO_COUNT * LFO_KEYS.len());
    let mut used = false;
    for i in 1..=LFO_COUNT {
        for k in LFO_KEYS {
            let v = slots.get_param(slot, &format!("lfo{i}:{k}")).unwrap_or_default();
            if !v.is_empty() {
                if k == "target" || k == "target_param" {
                    used = true;
                } else if k == "enabled" && v != "0" {
                    used = true;
                }
            }
            vals.push(v);
        }
    }
    if used { pack(&vals) } else { String::new() }
}

fn put(out: &mut String, s: &str) {
    out.push_str(&format!("{}\n{}", s.len(), s));
}

fn pack(items: &[String]) -> String {
    let mut out = format!("{}\n", items.len());
    for it in items {
        put(&mut out, it);
    }
    out
}

/// Split a document into its flat item list. `None` — never an empty list —
/// when the payload is malformed: a truncated document read as "no chains"
/// would clear the set.
pub fn parse_items(doc: &str) -> Option<Vec<String>> {
    parse_items_n(doc, FIELDS)
}

/// `parse_items`, with the record width to enforce. The nested LFO document is
/// a flat list, so it passes 1.
pub fn parse_items_n(doc: &str, width: usize) -> Option<Vec<String>> {
    let s = doc.as_bytes();
    let nl = s.iter().position(|&c| c == b'\n')?;
    let count: usize = std::str::from_utf8(&s[..nl]).ok()?.parse().ok()?;
    if count % width != 0 {
        return None;
    }
    let mut p = nl + 1;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let start = p;
        let nl = s[start..].iter().position(|&c| c == b'\n')? + start;
        let len: usize = std::str::from_utf8(&s[start..nl]).ok()?.parse().ok()?;
        let from = nl + 1;
        let to = from.checked_add(len)?;
        if to > s.len() {
            return None;
        }
        out.push(String::from_utf8_lossy(&s[from..to]).into_owned());
        p = to;
    }
    Some(out)
}

/// Everything about the chains, in one document.
pub fn serialize(slots: &mut ChainSlots) -> String {
    let entries = crate::chain_doc::decode(&slots.chain_set()).unwrap_or_default();
    let mut items: Vec<String> = Vec::new();
    let mut prev_slot: Option<usize> = None;
    for e in entries {
        let state = slots
            .get_param(e.slot, &format!("{}:state", e.component))
            .unwrap_or_default();
        // The mixer triple belongs to the CHAIN, so it rides that chain's first
        // component rather than being repeated on every one of them.
        // The mixer triple and the LFOs belong to the CHAIN, so they ride its
        // first component rather than being repeated on every one of them.
        let (mix, lfo) = if prev_slot == Some(e.slot) {
            (String::new(), String::new())
        } else {
            prev_slot = Some(e.slot);
            (slots.mix_csv(e.slot).unwrap_or_default(), lfo_state(slots, e.slot))
        };
        items.push(e.slot.to_string());
        items.push(e.component.clone());
        items.push(e.module.clone());
        items.push(state);
        items.push(mix);
        items.push(lfo);
    }
    pack(&items)
}

/// Apply a document read from disk. `false` when it is malformed — the caller
/// must leave the live set alone rather than clearing it.
pub fn restore(slots: &mut ChainSlots, doc: &str) -> bool {
    let Some(items) = parse_items(doc) else {
        return false;
    };
    let mut load_doc: Vec<String> = Vec::with_capacity(items.len() / FIELDS * 3);
    for c in items.chunks(FIELDS) {
        load_doc.push(c[0].clone());
        load_doc.push(c[1].clone());
        load_doc.push(c[2].clone());
    }
    if !slots.set_chain_set(&pack(&load_doc)) {
        return false;
    }
    /* States and mixes are applied after the loads are REQUESTED, never before:
     * ChainSlots holds `desired`, so a state written now is attached to the
     * queued load rather than racing it. */
    for c in items.chunks(FIELDS) {
        let Ok(slot) = c[0].parse::<usize>() else { continue };
        if !c[3].is_empty() {
            slots.set_state(slot, &c[1], &c[3]);
        }
        if !c[4].is_empty() {
            if let Some(mix) = crate::parse_mix(&c[4]) {
                slots.set_mix(slot, mix);
            }
        }
        if !c[5].is_empty() {
            if let Some(vals) = parse_items_n(&c[5], 1) {
                let mut i = 0;
                for n in 1..=LFO_COUNT {
                    for k in LFO_KEYS {
                        if let Some(v) = vals.get(i) {
                            if !v.is_empty() {
                                slots.set_param(slot, &format!("lfo{n}:{k}"), v);
                            }
                        }
                        i += 1;
                    }
                }
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /* A hand-built document stands in for a live ChainSlots: these tests pin
     * the FORMAT, which is the half TypeScript has to agree with. The
     * round-trip against real slots needs a loaded chain host, so it is a
     * device concern (test-seq.sh). */
    fn doc(items: &[&str]) -> String {
        let mut out = format!("{}\n", items.len());
        for it in items {
            out.push_str(&format!("{}\n{}", it.len(), it));
        }
        out
    }

    #[test]
    fn an_empty_set_is_the_count_zero_document() {
        assert_eq!(parse_items("0\n"), Some(vec![]));
    }

    #[test]
    fn reads_back_what_it_writes() {
        let d = doc(&["0", "synth", "noisemaker", "preset-blob", "1.0000,0.0000,0", ""]);
        let items = parse_items(&d).expect("parses");
        assert_eq!(items.len(), 6);
        assert_eq!(items[2], "noisemaker");
        assert_eq!(items[4], "1.0000,0.0000,0");
    }

    /* A preset blob is arbitrary bytes. The length prefix is the whole reason
     * this format was chosen over JSON: no escaping, nothing to get wrong. */
    #[test]
    fn a_blob_containing_newlines_and_quotes_survives() {
        let nasty = "a\nb\"c\\d\ne";
        let d = doc(&["0", "synth", "m", nasty, "", ""]);
        assert_eq!(parse_items(&d).expect("parses")[3], nasty);
    }

    /* chain_doc's rule, restated because it is the §3 hazard in another file:
     * a malformed document is NOT an empty set. Reading it as one would hand
     * the save a set with no chains and delete the user's work. */
    #[test]
    fn a_truncated_document_is_none_not_empty() {
        assert!(parse_items("5\n4\nsynth").is_none());
        assert!(parse_items("notanumber\n").is_none());
    }

    #[test]
    fn an_item_count_that_is_not_a_whole_record_is_rejected() {
        assert!(parse_items(&doc(&["0", "synth", "m", "", ""])).is_none());
    }

    /* The cross-language contract the ui-state mirror rests on: TypeScript's
     * decodeBulk must read exactly what pack() writes. Pinned as a golden
     * document so both sides assert against the same bytes — the node half
     * lives in browser-test/logic/set-state.mjs. The bytes came from
     * encodeBulk itself, not from reading the format and typing them out —
     * the hand-written version was wrong on its first attempt.
     *
     * The blob deliberately carries a newline and a quote: that is what the
     * length prefix buys over JSON, and it is the case an escaping bug hits. */
    pub(crate) const GOLDEN: &str =
        "12\n1\n05\nsynth10\nnoisemaker7\nbl\"ob\nx15\n1.0000,0.0000,084\n22\n1\n14\nsine1\n03\n2.00\n2\n501\n01\n05\nsynth6\ncutoff1\n01\n03\ntri1\n03\n1.00\n1\n01\n01\n00\n0\n1\n01\n03\nfx15\nmverb0\n0\n0\n";

    #[test]
    fn pack_matches_the_typescript_codec() {
        let lfo = "22\n1\n14\nsine1\n03\n2.00\n2\n501\n01\n05\nsynth6\ncutoff1\n01\n03\ntri1\n03\n1.00\n1\n01\n01\n00\n0\n1\n0";
        let items: Vec<String> = ["0", "synth", "noisemaker", "bl\"ob\nx", "1.0000,0.0000,0", lfo,
                                  "0", "fx1", "mverb", "", "", ""]
            .iter().map(|s| s.to_string()).collect();
        assert_eq!(pack(&items), GOLDEN);
        assert_eq!(parse_items(GOLDEN).expect("parses"), items);
    }

    /* The LFO half, which no component's `:state` blob carries: without it an
     * assignment appears to work right up until the tool closes. The nested
     * document is read back positionally, so its ORDER is the contract with
     * lfo-persist.ts — a reordering writes one LFO's depth into another's rate.
     *
     * An idle chain writes "" rather than 22 empty fields, matching
     * packLfoState: an untouched track puts nothing in the set file. */
    #[test]
    fn the_lfo_document_nests_and_reads_back_positionally() {
        let vals: Vec<String> = (0..22).map(|i| format!("v{i}")).collect();
        let nested = pack(&vals);
        let outer = pack(&["0".into(), "synth".into(), "m".into(), String::new(),
                           String::new(), nested.clone()]);
        let items = parse_items(&outer).expect("parses");
        assert_eq!(items[5], nested, "the nested document survives the outer one");
        assert_eq!(parse_items_n(&items[5], 1).expect("nested parses"), vals);
    }
}
