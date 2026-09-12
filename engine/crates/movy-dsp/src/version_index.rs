//! The version index — `sets/<uuid>/versions.json`.
//!
//! Real JSON, hand-parsed, because the crate carries no dependencies and this
//! file is the one thing both halves of the flag must read. The shape is flat
//! by construction (integers, booleans and one enum word, no nesting), which is
//! what makes a scan over `{`…`}` sufficient rather than merely convenient.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Why {
    Open,
    Auto,
    Exit,
    PreWipe,
    PreRestore,
    Adopted,
}

impl Why {
    pub fn as_str(self) -> &'static str {
        match self {
            Why::Open => "open",
            Why::Auto => "auto",
            Why::Exit => "exit",
            Why::PreWipe => "pre-wipe",
            Why::PreRestore => "pre-restore",
            Why::Adopted => "adopted",
        }
    }

    pub fn from_str(s: &str) -> Option<Why> {
        Some(match s {
            "open" => Why::Open,
            "auto" => Why::Auto,
            "exit" => Why::Exit,
            "pre-wipe" => Why::PreWipe,
            "pre-restore" => Why::PreRestore,
            "adopted" => Why::Adopted,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct VersionRec {
    /// Directory under `v/`, never reused.
    pub n: u32,
    /// Envelope generation — THE ORDERING KEY.
    pub gen: u32,
    /// Capture time, or 0 when unknown. Display and bucketing only.
    pub ms: u64,
    pub why: Why,
    /// How a user tells a real version from a blank one.
    pub clips: u32,
    pub ui: bool,
    /// Whether `v/<n>/chains.json` exists. Absent in records written before the
    /// engine owned the chains, where the chains rode inside the ui blob.
    pub ch: bool,
}

pub struct Index {
    pub next: u32,
    pub v: Vec<VersionRec>,
}

/// The raw text of `"key":` inside one flat object, or None. Values here never
/// contain a comma, a brace or an escape, which is what keeps this honest.
fn field<'a>(obj: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\":");
    let start = obj.find(&pat)? + pat.len();
    let rest = &obj[start..];
    let end = rest.find([',', '}']).unwrap_or(rest.len());
    Some(rest[..end].trim().trim_matches('"'))
}

fn num<T: std::str::FromStr>(obj: &str, key: &str) -> Option<T> {
    field(obj, key)?.parse::<T>().ok()
}

fn flag(obj: &str, key: &str) -> bool {
    field(obj, key) == Some("true")
}

fn record(obj: &str) -> Option<VersionRec> {
    Some(VersionRec {
        n: num(obj, "n")?,
        gen: num(obj, "gen")?,
        ms: num(obj, "ms")?,
        why: Why::from_str(field(obj, "why")?)?,
        clips: num(obj, "clips").unwrap_or(0),
        ui: flag(obj, "ui"),
        ch: flag(obj, "ch"),
    })
}

/// Parse, dropping anything unusable. An unreadable index reads as NO VERSIONS
/// — never as permission to delete, the same rule the sweep applies to an
/// unreadable `Sets/`.
pub fn parse(raw: Option<&str>) -> Index {
    let Some(raw) = raw else {
        return Index { next: 1, v: Vec::new() };
    };
    let mut v: Vec<VersionRec> = Vec::new();
    if let Some(arr) = raw.find("\"v\":").map(|i| &raw[i + 4..]) {
        let mut rest = arr;
        while let Some(open) = rest.find('{') {
            let Some(close) = rest[open..].find('}') else { break };
            if let Some(r) = record(&rest[open..open + close]) {
                v.push(r);
            }
            rest = &rest[open + close + 1..];
        }
    }
    v.sort_by(|a, b| b.gen.cmp(&a.gen).then(b.n.cmp(&a.n)));
    let mut next = num::<u32>(raw, "next").filter(|n| *n >= 1).unwrap_or(1);
    for r in &v {
        if r.n >= next {
            next = r.n + 1;
        }
    }
    Index { next, v }
}

pub fn serialize(idx: &Index) -> String {
    let mut s = format!("{{\"next\":{},\"v\":[", idx.next);
    for (i, r) in idx.v.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!(
            "{{\"n\":{},\"gen\":{},\"ms\":{},\"why\":\"{}\",\"clips\":{},\"ui\":{},\"ch\":{}}}",
            r.n, r.gen, r.ms, r.why.as_str(), r.clips, r.ui, r.ch
        ));
    }
    s.push_str("]}");
    s
}

/// Clips in a payload. The one number the menu shows that says whether a
/// version is worth restoring.
pub fn count_clips(payload: &str) -> u32 {
    payload.lines().filter(|l| l.starts_with("cl ")).count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    /* The bytes TypeScript actually writes (version-store.ts → JSON.stringify
     * of the record literal). Pinned as a golden because the flag is an escape
     * hatch in BOTH directions: an engine that cannot read what the old path
     * wrote turns a flag flip into an empty history. */
    const TS_INDEX: &str = r#"{"next":4,"v":[{"n":3,"gen":9,"ms":1788892154000,"why":"open","clips":6,"ui":true},{"n":1,"gen":4,"ms":0,"why":"adopted","clips":2,"ui":false}]}"#;

    #[test]
    fn reads_what_typescript_wrote() {
        let idx = parse(Some(TS_INDEX));
        assert_eq!(idx.v.len(), 2);
        assert_eq!(idx.v[0].n, 3, "newest first");
        assert_eq!(idx.v[0].gen, 9);
        assert_eq!(idx.v[0].ms, 1788892154000);
        assert_eq!(idx.v[0].why, Why::Open);
        assert_eq!(idx.v[0].clips, 6);
        assert!(idx.v[0].ui);
        /* A record written before this step has no `ch` field at all, and the
         * chains it carries live inside its ui blob. Absent must read as false
         * or the restore would look for a file that was never written. */
        assert!(!idx.v[0].ch);
        assert_eq!(idx.v[1].why, Why::Adopted);
        assert_eq!(idx.next, 4);
    }

    #[test]
    fn an_unreadable_index_is_no_versions_never_a_licence_to_delete() {
        assert_eq!(parse(None).v.len(), 0);
        assert_eq!(parse(Some("{{{")).v.len(), 0);
        assert_eq!(parse(None).next, 1, "numbering still starts at 1");
    }

    /* A version whose generation cannot be read cannot be ordered, and an
     * unordered entry in a restore menu is worse than an absent one. */
    #[test]
    fn unusable_records_are_dropped_not_defaulted() {
        assert_eq!(parse(Some(r#"{"next":2,"v":[{"gen":1,"ms":0,"why":"open"}]}"#)).v.len(), 0);
        assert_eq!(parse(Some(r#"{"next":2,"v":[{"n":1,"gen":1,"ms":0,"why":"nope"}]}"#)).v.len(), 0);
    }

    /* `next` must outrank every n on disk. A truncated write that lost the
     * counter would otherwise hand the next capture a directory that already
     * exists — the one corruption self-heal cannot undo, because the old
     * version's files are gone by the time anyone notices. */
    #[test]
    fn next_is_repaired_past_the_highest_n() {
        let raw = r#"{"next":1,"v":[{"n":9,"gen":1,"ms":0,"why":"open","clips":0,"ui":false,"ch":false}]}"#;
        assert_eq!(parse(Some(raw)).next, 10);
    }

    #[test]
    fn round_trips_through_serialize() {
        let idx = parse(Some(TS_INDEX));
        let again = parse(Some(&serialize(&idx)));
        assert_eq!(again.v.len(), 2);
        assert_eq!(again.v[0].n, 3);
        assert_eq!(again.next, 4);
    }

    /* Key order matches the TypeScript record literal so a diff of two devices'
     * files is about content, not about who wrote it. */
    #[test]
    fn serializes_in_the_typescript_key_order() {
        let idx = Index { next: 2, v: vec![VersionRec {
            n: 1, gen: 5, ms: 7, why: Why::PreWipe, clips: 2, ui: true, ch: true,
        }] };
        assert_eq!(serialize(&idx),
            r#"{"next":2,"v":[{"n":1,"gen":5,"ms":7,"why":"pre-wipe","clips":2,"ui":true,"ch":true}]}"#);
    }

    #[test]
    fn counts_clips() {
        assert_eq!(count_clips("movy1\ncl 0 0 16 0 x\ncp 0\ncl 1 0 16 0 y\n"), 2);
        assert_eq!(count_clips("movy1\n"), 0);
    }

    /* Ordering is by generation, and n breaks the tie — the same comparator
     * version-index.ts sorts with, because the menu's order IS the feature. */
    #[test]
    fn orders_by_generation_then_n() {
        let raw = r#"{"next":9,"v":[
            {"n":1,"gen":4,"ms":0,"why":"open","clips":0,"ui":false,"ch":false},
            {"n":8,"gen":4,"ms":0,"why":"auto","clips":0,"ui":false,"ch":false},
            {"n":2,"gen":7,"ms":0,"why":"exit","clips":0,"ui":false,"ch":false}]}"#;
        let v = parse(Some(raw)).v;
        assert_eq!((v[0].n, v[1].n, v[2].n), (2, 8, 1));
    }
}
