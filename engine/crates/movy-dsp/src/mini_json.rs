//! Just enough JSON for the Set library's index.
//!
//! The crate takes no dependencies, and `version_index.rs` gets away with a
//! field scanner only because its values never hold a comma or a quote. A Set
//! NAME can hold both — it is whatever the user typed — so the library needs a
//! real reader and a real escaper. Total by construction: malformed input is
//! `None`, never a panic, because it runs on the engine's saver thread.

#[derive(Debug, Clone, PartialEq)]
pub enum J {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

impl J {
    pub fn get(&self, key: &str) -> Option<&J> {
        match self {
            J::Obj(kv) => kv.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        if let J::Str(s) = self { Some(s) } else { None }
    }
    pub fn as_u64(&self) -> Option<u64> {
        if let J::Num(n) = self { if *n >= 0.0 { return Some(*n as u64); } }
        None
    }
    pub fn as_arr(&self) -> &[J] {
        if let J::Arr(a) = self { a } else { &[] }
    }
    pub fn as_obj(&self) -> &[(String, J)] {
        if let J::Obj(o) = self { o } else { &[] }
    }
}

/// A JSON string literal, quotes included.
pub fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn parse(s: &str) -> Option<J> {
    let mut p = P { b: s.as_bytes(), i: 0, s };
    let v = p.value(0)?;
    p.ws();
    if p.i == p.b.len() { Some(v) } else { None }
}

struct P<'a> {
    b: &'a [u8],
    s: &'a str,
    i: usize,
}

/* Deep enough for any index this crate writes; shallow enough that hostile
 * nesting cannot exhaust the saver thread's stack. */
const MAX_DEPTH: u32 = 32;

impl<'a> P<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }
    fn eat(&mut self, c: u8) -> bool {
        self.ws();
        if self.b.get(self.i) == Some(&c) { self.i += 1; true } else { false }
    }
    fn lit(&mut self, word: &str, v: J) -> Option<J> {
        if self.s[self.i..].starts_with(word) { self.i += word.len(); Some(v) } else { None }
    }
    fn value(&mut self, depth: u32) -> Option<J> {
        if depth > MAX_DEPTH { return None; }
        self.ws();
        match *self.b.get(self.i)? {
            b'{' => {
                self.i += 1;
                let mut kv = Vec::new();
                if self.eat(b'}') { return Some(J::Obj(kv)); }
                loop {
                    self.ws();
                    let k = self.string()?;
                    if !self.eat(b':') { return None; }
                    kv.push((k, self.value(depth + 1)?));
                    if self.eat(b',') { continue; }
                    return if self.eat(b'}') { Some(J::Obj(kv)) } else { None };
                }
            }
            b'[' => {
                self.i += 1;
                let mut a = Vec::new();
                if self.eat(b']') { return Some(J::Arr(a)); }
                loop {
                    a.push(self.value(depth + 1)?);
                    if self.eat(b',') { continue; }
                    return if self.eat(b']') { Some(J::Arr(a)) } else { None };
                }
            }
            b'"' => self.string().map(J::Str),
            b't' => self.lit("true", J::Bool(true)),
            b'f' => self.lit("false", J::Bool(false)),
            b'n' => self.lit("null", J::Null),
            _ => {
                let start = self.i;
                while self.i < self.b.len() && matches!(self.b[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                    self.i += 1;
                }
                self.s[start..self.i].parse::<f64>().ok().map(J::Num)
            }
        }
    }
    fn string(&mut self) -> Option<String> {
        if self.b.get(self.i) != Some(&b'"') { return None; }
        self.i += 1;
        let mut out = String::new();
        loop {
            let c = self.s[self.i..].chars().next()?;
            self.i += c.len_utf8();
            match c {
                '"' => return Some(out),
                '\\' => {
                    let e = *self.b.get(self.i)?;
                    self.i += 1;
                    match e {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'b' | b'f' => out.push(' '),
                        b'u' => {
                            let hex = self.s.get(self.i..self.i + 4)?;
                            self.i += 4;
                            /* Surrogate halves read as U+FFFD: a name with an
                             * astral character degrades, it does not fail. */
                            out.push(char::from_u32(u32::from_str_radix(hex, 16).ok()?).unwrap_or('\u{fffd}'));
                        }
                        _ => return None,
                    }
                }
                c => out.push(c),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_hostile_name() {
        let name = "a \"quoted\", {braced} \\ name\twith é";
        let v = parse(&format!("{{\"n\":{}}}", esc(name))).unwrap();
        assert_eq!(v.get("n").unwrap().as_str(), Some(name));
    }

    #[test]
    fn reads_nested_values() {
        let v = parse(r#"{"a":[1,2,{"b":true}],"c":null,"d":1760000000123}"#).unwrap();
        assert_eq!(v.get("a").unwrap().as_arr().len(), 3);
        assert_eq!(v.get("d").unwrap().as_u64(), Some(1_760_000_000_123));
    }

    #[test]
    fn malformed_is_none_not_a_panic() {
        for bad in ["", "{", "{\"a\":}", "[1,", "\"abc", "{\"a\":1}x", "\"\\u12\""] {
            assert!(parse(bad).is_none(), "{bad}");
        }
        assert!(parse(&"[".repeat(100)).is_none(), "depth is bounded");
    }
}
