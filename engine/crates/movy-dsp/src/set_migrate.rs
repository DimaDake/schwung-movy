//! The one migration: every Set Move and schwung ever held, into movy's library.
//!
//! Three generations of storage meet here, all keyed by Move's Set uuid:
//! - movy's overtake-era tree, `modules/tools/movy/sets/<uuid>/`, whose chains
//!   are in `chains.json` — or, older still, only in `ui-state.json`'s mirror;
//! - schwung's per-Set files, `set_state/<uuid>/`: tracks 1-4 as `slot_N.json`
//!   (plus their level in `shadow_chain_config.json`) and the master as
//!   `master_fx_N.json`;
//! - Move's own Sets, on whichever of schwung's set pages they are parked,
//!   which is only where the NAME comes from.
//!
//! It all lands as the one format the engine opens: `chains.json` and
//! `seq-state.json` in `Sets/<id>/`. After this nothing else reads old storage.
//!
//! COPY, NEVER MOVE. Every source stays exactly where it is — the Move+schwung
//! door still opens them, and the user did not ask for anything to be cleaned up.
//!
//! Runs ONCE on its own (`Library::migrated`). The manual run (`force`) puts
//! every Set that came from Move back the way Move has it, after keeping what
//! it replaces as a version; Sets made in movy are never touched by either.

use crate::chain_slots::{master_index, send_index, MOVY_CHAINS, SEND_COMPONENT};
use crate::chain_state::{pack, parse_items, parse_items_n, LFO_KEYS};
use crate::master_chain::IMPORT_MARK;
use crate::mini_json::{num, parse, to_json, J};
use crate::set_envelope::BLANK_STATE;
use crate::set_library::{clean_name, Entry, Library};
use crate::set_store::{atomic_write, ensure_dir, is_blank, SetStore};
use crate::version_index::Why;
use crate::version_store::{read_index, write_version, Capture};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// `SET_PAGES_TOTAL` in schwung's `shadow_set_pages.h` (same as set_gc.rs).
const SET_PAGES_TOTAL: u32 = 8;
/// schwung's shadow slots: the tracks that were schwung's, 1-4.
const SCHWUNG_SLOTS: usize = 4;
/// `MASTER_FX_SLOTS` in schwung — the master_fx_N.json files.
const MASTER_FILES: usize = 4;
/// The width of one chains.json record (chain_state.rs `FIELDS`).
const FIELDS: usize = 6;
/// What the old overtake build wrote into a Set it had moved tracks 1-4 out
/// of schwung for. Such a Set's slot files are leftovers, never cleared.
const MIGV_DONE: u64 = 1;

pub struct MigrateSrc {
    /// movy's legacy `modules/tools/movy/sets/`.
    pub legacy: PathBuf,
    /// Move's `UserLibrary/Sets/`, where `<uuid>/<Set name>/` gives the name.
    pub move_sets: PathBuf,
    /// schwung's parked set pages; the first root's `current_page.txt` says
    /// which page `move_sets` is showing.
    pub pages: Vec<PathBuf>,
    /// schwung's `set_state/`.
    pub state: PathBuf,
}

/// A Set Move knows, wherever schwung parked it.
#[derive(Clone, Debug, PartialEq)]
pub struct MoveSet {
    pub uuid: String,
    pub name: String,
    pub page: u32,
}

/// Not a Set: a pad Move never committed, or no answer at all. Its content is
/// still the user's, so it comes across under a name that says what it was.
fn provisional(uuid: &str) -> bool {
    uuid == "_default" || uuid.starts_with("__")
}

/// UTC calendar date of an epoch-ms timestamp (Howard Hinnant's
/// civil_from_days). The device has no reliable zone, and a date in a name is
/// a label, not a record.
pub fn date_of(ms: u64) -> String {
    let z = (ms / 86_400_000) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn subdirs(dir: &Path) -> Vec<String> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut v: Vec<String> = rd.filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !n.starts_with('.'))
        .collect();
    v.sort();
    v
}

/// The one subfolder Move keeps a Set's `Song.abl` in IS the Set's name.
fn only_subdir(dir: &Path) -> Option<String> {
    let v = subdirs(dir);
    if v.len() == 1 { v.into_iter().next() } else { None }
}

fn current_page(src: &MigrateSrc) -> u32 {
    src.pages.first()
        .and_then(|r| fs::read_to_string(r.join("current_page.txt")).ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .filter(|&p| p < SET_PAGES_TOTAL)
        .unwrap_or(0)
}

/// Every Set on every page. A uuid seen twice (a page switch torn by a power
/// cut) is listed once, at its first sighting.
pub fn move_sets(src: &MigrateSrc) -> Vec<MoveSet> {
    let mut out: Vec<MoveSet> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut take = |dir: &Path, page: u32, out: &mut Vec<MoveSet>| {
        for uuid in subdirs(dir) {
            if seen.contains(&uuid) { continue; }
            if let Some(name) = only_subdir(&dir.join(&uuid)) {
                seen.insert(uuid.clone());
                out.push(MoveSet { uuid, name, page });
            }
        }
    };
    take(&src.move_sets, current_page(src), &mut out);
    for root in &src.pages {
        for page in 0..SET_PAGES_TOTAL {
            take(&root.join(format!("page_{page}")), page, &mut out);
        }
    }
    out
}

/// The library name for each uuid. Eight pages make two "Set 1"s likely, and
/// a list of identical names is a list nobody can pick from — so a name that
/// occurs on more than one page keeps it plain on the lowest page and says the
/// page everywhere else. A name used once is left exactly as Move has it.
pub fn page_names(sets: &[MoveSet]) -> HashMap<String, String> {
    let mut by_name: HashMap<&str, Vec<&MoveSet>> = HashMap::new();
    for s in sets { by_name.entry(s.name.as_str()).or_default().push(s); }
    let mut out = HashMap::new();
    for (name, mut group) in by_name {
        group.sort_by(|a, b| a.page.cmp(&b.page).then_with(|| a.uuid.cmp(&b.uuid)));
        let lowest = group[0].page;
        for s in group {
            let n = if s.page == lowest { name.to_string() } else { format!("{name} P{}", s.page + 1) };
            out.insert(s.uuid.clone(), clean_name(&n));
        }
    }
    out
}

/// When the Set began: its oldest kept version, else its oldest file.
fn created_of(dir: &Path) -> u64 {
    let vms = fs::read_to_string(dir.join("versions.json")).ok()
        .and_then(|raw| crate::version_index::parse(Some(&raw)).v.iter().map(|r| r.ms).filter(|&m| m > 0).min());
    if let Some(m) = vms { return m; }
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    rd.filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.metadata().ok()?.modified().ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .min()
        .unwrap_or(0)
}

/// `cp -r`, leaving every file writable by both halves of movy — the engine
/// writes as root, movy-host as ableton (set_store.rs).
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    ensure_dir(to).map_err(std::io::Error::other)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let dst = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_tree(&e.path(), &dst)?;
        } else {
            fs::copy(e.path(), &dst)?;
            let _ = fs::set_permissions(&dst, fs::Permissions::from_mode(0o666));
        }
    }
    Ok(())
}

fn read_json(path: &Path) -> Option<J> {
    parse(&fs::read_to_string(path).ok()?)
}

/// A JSON scalar as a param value; `None` for anything that is not one.
fn scalar(j: &J) -> Option<String> {
    match j {
        J::Str(s) => Some(s.clone()),
        J::Num(n) => Some(num(*n)),
        J::Bool(b) => Some(if *b { "1" } else { "0" }.to_string()),
        _ => None,
    }
}

fn truthy(j: Option<&J>) -> bool {
    match j {
        Some(J::Num(n)) => *n != 0.0,
        Some(J::Bool(b)) => *b,
        Some(J::Str(s)) => s != "0" && !s.is_empty(),
        _ => false,
    }
}

/// A module's preset as the string the module is handed. schwung stored a
/// JSON preset parsed and anything else as a string.
fn preset(state: Option<&J>) -> Option<String> {
    match state? {
        J::Str(s) if !s.is_empty() => Some(s.clone()),
        j @ (J::Obj(_) | J::Arr(_)) => Some(to_json(j)),
        _ => None,
    }
}

/// schwung's `{lfo1:{…}, lfo2:{…}}` as chain_state's nested positional
/// document — the field names are the chain host's own on both sides. "" when
/// neither LFO does anything, as chain_state writes for an idle chain.
fn lfo_doc(lfos: Option<&J>) -> String {
    let Some(lfos) = lfos else { return String::new() };
    let mut vals: Vec<String> = Vec::with_capacity(2 * LFO_KEYS.len());
    let mut used = false;
    for n in 1..=2 {
        let l = lfos.get(&format!("lfo{n}"));
        for k in LFO_KEYS {
            let v = l.and_then(|l| l.get(k)).and_then(scalar).unwrap_or_default();
            if (k == "target" || k == "target_param") && !v.is_empty() { used = true; }
            if k == "enabled" && !v.is_empty() && v != "0" { used = true; }
            vals.push(v);
        }
    }
    if used { pack(&vals) } else { String::new() }
}

type Rec = Vec<String>;

fn rec(slot: usize, c: &str, m: &str, s: &str, mix: &str, lfo: &str) -> Rec {
    vec![slot.to_string(), c.into(), m.into(), s.into(), mix.into(), lfo.into()]
}

/// The pre-engine layer: chains that lived only in `ui-state.json`.
fn mirror_records(ui: &J) -> Vec<Rec> {
    let mut out = Vec::new();
    for t in ui.get("chains").map_or(&[][..], |v| v.as_arr()) {
        let Some(slot) = t.get("t").and_then(|v| v.as_u64()).map(|v| v as usize) else { continue };
        if slot >= MOVY_CHAINS { continue; }
        let mix = t.get("mix").and_then(|v| v.as_str()).unwrap_or("");
        let lfo: Vec<String> = t.get("lfo").map_or(&[][..], |v| v.as_arr()).iter()
            .map(|v| scalar(v).unwrap_or_default()).collect();
        let lfo = if lfo.len() == 2 * LFO_KEYS.len() { pack(&lfo) } else { String::new() };
        let mut first = true;
        for c in t.get("comp").map_or(&[][..], |v| v.as_arr()) {
            let (Some(cc), Some(m)) = (c.get("c").and_then(|v| v.as_str()), c.get("m").and_then(|v| v.as_str()))
                else { continue };
            if m.is_empty() { continue; }
            let s = c.get("s").and_then(|v| v.as_str()).unwrap_or("");
            out.push(if first { rec(slot, cc, m, s, mix, &lfo) } else { rec(slot, cc, m, s, "", "") });
            first = false;
        }
    }
    for b in ui.get("sends").map_or(&[][..], |v| v.as_arr()) {
        let (Some(bus), Some(m)) = (b.get("b").and_then(|v| v.as_u64()), b.get("m").and_then(|v| v.as_str()))
            else { continue };
        if m.is_empty() || bus as usize >= crate::send_bus::SEND_BUSES { continue; }
        let s = b.get("s").and_then(|v| v.as_str()).unwrap_or("");
        out.push(rec(send_index(bus as usize), SEND_COMPONENT, m, s, "", ""));
    }
    out
}

/// One schwung chain position, or why it stayed behind.
fn position(slot: usize, comp: &str, module: Option<&str>, state: Option<&J>, bypassed: Option<&J>,
            what: &str, notes: &mut Vec<String>) -> Option<(String, String)> {
    let m = module.filter(|m| !m.is_empty())?;
    /* A bypassed effect is silent in the Set the user hears, and the chain
     * document has no bypass to carry — so leaving it out is what keeps the
     * Set sounding the same. */
    if truthy(bypassed) {
        notes.push(format!("{what} {comp} {m}: bypassed, left out"));
        return None;
    }
    let s = preset(state).unwrap_or_else(|| {
        notes.push(format!("{what} {comp} {m}: no preset, comes up at defaults"));
        String::new()
    });
    let _ = slot;
    Some((comp.to_string(), s))
}

/// A schwung slot as movy chain records: synth, the first MIDI FX, two audio
/// FX — what a movy track has places for. The rest is named in `notes`.
fn slot_records(t: usize, slot: &J, level: Option<&J>, notes: &mut Vec<String>) -> Vec<Rec> {
    let Some(chain) = slot.get("chain") else { return Vec::new() };
    let what = format!("track {}", t + 1);
    let mut comps: Vec<(String, String, String)> = Vec::new();   // (component, module, preset)
    if let Some(s) = chain.get("synth") {
        let m = s.get("module").and_then(|v| v.as_str());
        if let Some((c, p)) = position(t, "synth", m, s.get("config").and_then(|c| c.get("state")),
                                       s.get("bypassed"), &what, notes) {
            comps.push((c, m.unwrap_or("").to_string(), p));
        }
    }
    for (list, prefix, room) in [("midi_fx", "midi_fx", 1usize), ("audio_fx", "fx", 2)] {
        for (i, fx) in chain.get(list).map_or(&[][..], |v| v.as_arr()).iter().enumerate() {
            let m = fx.get("type").and_then(|v| v.as_str());
            let comp = format!("{prefix}{}", i + 1);
            if i >= room {
                if let Some(m) = m { notes.push(format!("{what} {comp} {m}: no place on a movy track, left out")); }
                continue;
            }
            if let Some((c, p)) = position(t, &comp, m, fx.get("params").and_then(|c| c.get("state")),
                                           fx.get("bypassed"), &what, notes) {
                comps.push((c, m.unwrap_or("").to_string(), p));
            }
        }
    }
    if comps.is_empty() { return Vec::new(); }
    /* schwung's slot fader and mute are linear and unity at 1.0, the same as
     * movy's mixer gain; pan and sends have no schwung equivalent. Absent at
     * the default, as chain_state writes an untouched track. */
    let vol = level.and_then(|l| l.get("volume")).and_then(|v| if let J::Num(n) = v { Some(*n) } else { None })
        .filter(|v| v.is_finite()).unwrap_or(1.0);
    let muted = truthy(level.and_then(|l| l.get("muted")));
    let mix = if vol != 1.0 || muted {
        format!("{vol:.4},0.0000,{},0.0000,0.0000", u8::from(muted))
    } else { String::new() };
    let lfo = lfo_doc(chain.get("lfos"));
    comps.into_iter().enumerate()
        .map(|(i, (c, m, p))| if i == 0 { rec(t, &c, &m, &p, &mix, &lfo) } else { rec(t, &c, &m, &p, "", "") })
        .collect()
}

fn master_records(dir: &Path, notes: &mut Vec<String>) -> Vec<Rec> {
    let mi = master_index();
    let mut out: Vec<Rec> = Vec::new();
    let mut lfo = String::new();
    for i in 0..MASTER_FILES {
        let Some(j) = read_json(&dir.join(format!("master_fx_{i}.json"))) else { continue };
        /* The LFOs ride position 0's file even when position 0 is empty. */
        if i == 0 { lfo = lfo_doc(j.get("lfos")); }
        let m = j.get("module_id").and_then(|v| v.as_str());
        let comp = format!("fx{}", i + 1);
        if let Some((c, p)) = position(mi, &comp, m, j.get("state"), j.get("bypassed"), "master", notes) {
            out.push(rec(mi, &c, m.unwrap_or(""), &p, "", ""));
        }
    }
    /* An LFO with no module to modulate has nothing to attach to. */
    if let Some(first) = out.first_mut() { first[5] = lfo; }
    out
}

/// What a converted Set's chains are, and what did not come across.
pub struct Converted {
    pub chains: String,
    pub notes: Vec<String>,
}

/// Merge every older layer into one `chains.json`. Pure but for reading the
/// schwung files, so every rule here is a cargo test.
///
/// `chains`/`ui` are the Set's own movy files (either may be absent); `schwung`
/// is its `set_state/<uuid>/`, only for a Set still alive on a page.
///
/// What movy already holds always wins: a track or master movy has records for
/// is the user's movy work, and schwung never clears a slot, so the slot file
/// beside it is a stale copy.
pub fn convert(chains: Option<&str>, ui: Option<&str>, schwung: Option<&Path>) -> Converted {
    let mut notes = Vec::new();
    let ui = ui.and_then(parse);
    let mut recs: Vec<Rec> = match chains.and_then(parse_items) {
        Some(items) => items.chunks(FIELDS).map(|c| c.to_vec()).collect(),
        None => ui.as_ref().map(mirror_records).unwrap_or_default(),
    };
    let has = |recs: &[Rec], slot: usize| recs.iter().any(|r| r[0] == slot.to_string());
    if let Some(dir) = schwung {
        let migrated = ui.as_ref().and_then(|u| u.get("migv")).and_then(|v| v.as_u64())
            .is_some_and(|v| v >= MIGV_DONE);
        if !migrated {
            let cfg = read_json(&dir.join("shadow_chain_config.json"));
            for t in 0..SCHWUNG_SLOTS {
                if has(&recs, t) { continue; }
                let Some(slot) = read_json(&dir.join(format!("slot_{t}.json"))) else { continue };
                let level = cfg.as_ref().and_then(|c| c.get("slots")).map(|s| s.as_arr())
                    .and_then(|a| a.get(t));
                recs.extend(slot_records(t, &slot, level, &mut notes));
            }
        }
    }
    let mi = master_index();
    if !has(&recs, mi) {
        if let Some(dir) = schwung { recs.extend(master_records(dir, &mut notes)); }
    }
    /* The mark says "this Set's master has been brought over", so the master a
     * user then clears on purpose stays cleared. */
    if !recs.iter().any(|r| r[0] == mi.to_string() && r[1] == IMPORT_MARK) {
        recs.push(rec(mi, IMPORT_MARK, "1", "", "", ""));
    }
    let flat: Vec<String> = recs.into_iter().flatten().collect();
    Converted { chains: pack(&flat), notes }
}

/// Anything movy saved, or anything schwung holds for this Set.
fn legacy_has_content(store: &SetStore, uuid: &str) -> bool {
    if store.read_best(uuid).is_some() || store.chains_path(uuid).exists() { return true; }
    let ui = fs::read_to_string(store.set_dir(uuid).join("ui-state.json")).ok().and_then(|s| parse(&s));
    ui.is_some_and(|u| !u.get("chains").map_or(&[][..], |v| v.as_arr()).is_empty())
}

fn schwung_has_content(dir: &Path) -> bool {
    let mut probe = Vec::new();
    let any_slot = (0..SCHWUNG_SLOTS).any(|t| read_json(&dir.join(format!("slot_{t}.json")))
        .is_some_and(|j| !slot_records(t, &j, None, &mut probe).is_empty()));
    any_slot || (0..MASTER_FILES).any(|i| read_json(&dir.join(format!("master_fx_{i}.json")))
        .and_then(|j| j.get("module_id").and_then(|v| v.as_str()).map(|m| !m.is_empty()))
        .unwrap_or(false))
}

fn name_index_name(legacy: &Path, uuid: &str) -> Option<String> {
    let j = read_json(&legacy.join("name-index.json"))?;
    j.as_obj().iter().find(|(_, v)| v.as_str() == Some(uuid)).map(|(k, _)| k.clone())
}

/// One Set to bring across.
struct Plan {
    uuid: String,
    id: String,
    name: String,
    /// movy's own overtake-era folder, when it has one.
    legacy: Option<PathBuf>,
    /// schwung's `set_state/<uuid>/`, only for a Set alive on a page.
    schwung: Option<PathBuf>,
}

fn plans(src: &MigrateSrc) -> Vec<Plan> {
    let sets = move_sets(src);
    let names = page_names(&sets);
    let legacy = SetStore::new(src.legacy.to_str().unwrap_or(""));
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let alive_schwung = |uuid: &str| {
        let d = src.state.join(uuid);
        (names.contains_key(uuid) && d.is_dir()).then_some(d)
    };
    for uuid in subdirs(&src.legacy) {
        if !legacy_has_content(&legacy, &uuid) { continue; }
        let dir = legacy.set_dir(&uuid);
        let (id, name) = if provisional(&uuid) {
            let safe: String = uuid.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
            (format!("r{safe}"), format!("Recovered {}", date_of(created_of(&dir))))
        } else {
            let name = names.get(&uuid).cloned()
                .or_else(|| name_index_name(&src.legacy, &uuid))
                .unwrap_or_else(|| format!("Imported {}", date_of(created_of(&dir))));
            (uuid.clone(), name)
        };
        seen.insert(uuid.clone());
        out.push(Plan { schwung: alive_schwung(&uuid), uuid, id, name, legacy: Some(dir) });
    }
    for s in &sets {
        if seen.contains(&s.uuid) || provisional(&s.uuid) { continue; }
        let Some(dir) = alive_schwung(&s.uuid).filter(|d| schwung_has_content(d)) else { continue };
        out.push(Plan { uuid: s.uuid.clone(), id: s.uuid.clone(), name: names[&s.uuid].clone(),
                        legacy: None, schwung: Some(dir) });
    }
    out
}

/// A Set the manual run replaced — the saver hands the open one back to the
/// audio thread, the way a restore does.
pub struct Replaced {
    pub id: String,
    pub payload: String,
    pub chains: String,
    pub gen: u32,
    pub ui: Option<String>,
}

#[derive(Default)]
pub struct Outcome {
    /// Sets created or changed.
    pub n: u32,
    pub replaced: Vec<Replaced>,
}

fn read_file(p: &Path) -> Option<String> { fs::read_to_string(p).ok() }

fn log_notes(id: &str, notes: &[String]) {
    for n in notes { crate::host::log(&format!("migrate: {id}: {n}")); }
}

/// A Set the library does not have: its movy folder copied whole (history
/// included), then its chains rewritten as the merged document.
fn fresh(lib: &mut Library, store: &SetStore, p: &Plan) -> bool {
    let tmp_id = format!("{}.importing", p.id);
    let tmp = store.set_dir(&tmp_id);
    let _ = fs::remove_dir_all(&tmp);
    /* Into a temporary name first: a folder under its final id means a
     * finished copy. A crash before the rename leaves only `.importing`,
     * which the next run replaces. */
    let copied = match &p.legacy {
        Some(dir) => copy_tree(dir, &tmp).is_ok(),
        None => ensure_dir(&tmp).is_ok(),
    };
    if !copied {
        let _ = fs::remove_dir_all(&tmp);
        crate::host::log(&format!("migrate: copy of {} failed; retried next run", p.uuid));
        return false;
    }
    let conv = convert(store.read_chains(&tmp_id).as_deref(), read_file(&tmp.join("ui-state.json")).as_deref(),
                       p.schwung.as_deref());
    log_notes(&p.id, &conv.notes);
    let best = store.read_best(&tmp_id);
    let (payload, gen) = best.map_or((BLANK_STATE.to_string(), 1), |b| (b.payload, b.gen));
    /* A Set with chains but no sequence file opens as UNREADABLE (do_open), so
     * the sequence is written too — blank, when it never had one. */
    if store.write(&tmp_id, &payload, gen, &conv.chains).is_err() {
        let _ = fs::remove_dir_all(&tmp);
        return false;
    }
    let dst = store.set_dir(&p.id);
    let _ = fs::remove_dir_all(&dst);
    if fs::rename(&tmp, &dst).is_err() { return false; }
    let created = p.legacy.as_deref().or(p.schwung.as_deref()).map_or(0, created_of);
    let clips = crate::version_index::count_clips(&payload);
    lib.sets.retain(|e| e.id != p.id);
    lib.sets.push(Entry { id: p.id.clone(), name: clean_name(&p.name), created, parent: None,
                          legacy: Some(p.uuid.clone()), clips });
    true
}

/// The automatic run on a Set an earlier import already brought over: only
/// what it never got — schwung's tracks into empty tracks, and the master.
fn fill(store: &SetStore, p: &Plan, now: u64) -> bool {
    let chains = store.read_chains(&p.id);
    let ui = read_file(&store.set_dir(&p.id).join("ui-state.json"));
    let conv = convert(chains.as_deref(), ui.as_deref(), p.schwung.as_deref());
    if chains.as_deref() == Some(conv.chains.as_str()) { return false; }
    log_notes(&p.id, &conv.notes);
    let best = store.read_best(&p.id);
    /* The user's own Set is about to change, if only by a track it never had:
     * keep it as it was first, so BACKUPS can put it back. */
    if let Some(b) = &best {
        write_version(store, &p.id, &Capture { why: Why::PreRestore, payload: &b.payload, gen: b.gen,
            chains: chains.as_deref(), ui: ui.as_deref(), now });
    }
    let (payload, gen) = best.map_or((BLANK_STATE.to_string(), 1), |b| (b.payload, b.gen));
    store.write(&p.id, &payload, gen, &conv.chains).is_ok()
}

/// The manual run on a Set that came from Move: put it back the way Move and
/// schwung have it. What it replaces is kept as a version first, so a
/// mis-confirmed run is one restore away from undone.
fn replace(lib: &mut Library, store: &SetStore, p: &Plan, now: u64) -> Option<Replaced> {
    let dir = store.set_dir(&p.id);
    let ui_now = read_file(&dir.join("ui-state.json"));
    let cur = store.read_best(&p.id);
    if let Some(c) = &cur {
        write_version(store, &p.id, &Capture { why: Why::PreRestore, payload: &c.payload, gen: c.gen,
            chains: store.read_chains(&p.id).as_deref(), ui: ui_now.as_deref(), now });
    }
    let src = p.legacy.as_ref().map(|d| SetStore::new(d.parent().and_then(|r| r.to_str()).unwrap_or("")));
    let src_uuid = p.uuid.as_str();
    let src_chains = src.as_ref().and_then(|s| s.read_chains(src_uuid));
    let src_ui = p.legacy.as_ref().and_then(|d| read_file(&d.join("ui-state.json")));
    let conv = convert(src_chains.as_deref(), src_ui.as_deref(), p.schwung.as_deref());
    log_notes(&p.id, &conv.notes);
    let payload = src.as_ref().and_then(|s| s.read_best(src_uuid)).map_or(BLANK_STATE.to_string(), |b| b.payload);
    /* Above every copy AND every version, so nothing on disk outranks it —
     * including the capture just taken. */
    let mut top = cur.map_or(0, |c| c.gen);
    for r in &read_index(store, &p.id).v { top = top.max(r.gen); }
    let gen = top + 1;
    if is_blank(&payload, &conv.chains) {
        store.blank_files(&p.id);
    } else if let Err(e) = store.write(&p.id, &payload, gen, &conv.chains) {
        crate::host::log(&format!("migrate: {} not replaced: {e}", p.id));
        return None;
    }
    /* The ui half too: a Set Move has no movy blob for gets none, so no
     * octave or scale from what it replaced survives into the copy. */
    let ui_path = dir.join("ui-state.json");
    match &src_ui {
        Some(u) => { let _ = atomic_write(&ui_path, u); }
        None => { let _ = fs::remove_file(&ui_path); }
    }
    if let Some(e) = lib.sets.iter_mut().find(|e| e.id == p.id) {
        e.name = clean_name(&p.name);
        e.clips = crate::version_index::count_clips(&payload);
    }
    Some(Replaced { id: p.id.clone(), payload, chains: conv.chains, gen, ui: src_ui })
}

/// Run the migration. `None` when it has already run and this is not the
/// manual one. `progress(done, total)` is called before each Set.
pub fn migrate(lib: &mut Library, store: &SetStore, src: &MigrateSrc, force: bool, now: u64,
               progress: &dyn Fn(u32, u32)) -> Option<Outcome> {
    if lib.migrated != 0 && !force { return None; }
    let plans = plans(src);
    let total = plans.len() as u32;
    let mut out = Outcome::default();
    for (i, p) in plans.iter().enumerate() {
        progress(i as u32, total);
        let existing = lib.sets.iter().any(|e| e.id == p.id && e.legacy.as_deref() == Some(p.uuid.as_str()));
        let done = if existing && force {
            match replace(lib, store, p, now) {
                Some(r) => { out.replaced.push(r); true }
                None => false,
            }
        } else if existing {
            fill(store, p, now)
        } else if !force && lib.imported.iter().any(|u| *u == p.uuid) {
            /* Imported once and deleted since: the automatic run must not bring
             * it back. The manual one does — that is what it is for. */
            false
        } else {
            fresh(lib, store, p)
        };
        if done { out.n += 1; }
        if !lib.imported.iter().any(|u| *u == p.uuid) { lib.imported.push(p.uuid.clone()); }
    }
    progress(total, total);
    lib.migrated = now.max(1);
    crate::host::log(&format!("migrate: {} of {total} Set(s) {}", out.n, if force { "re-migrated" } else { "migrated" }));
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::set_library::tests::tmp;

    struct Fx { base: PathBuf, src: MigrateSrc, sets: PathBuf }

    fn fx(name: &str) -> Fx {
        let f = tmp(&format!("migrate-{name}"));
        let base = f.root.clone();
        let src = MigrateSrc { legacy: base.join("legacy"), move_sets: base.join("MoveSets"),
                               pages: vec![base.join("set_pages")], state: base.join("set_state") };
        fs::create_dir_all(&src.legacy).unwrap();
        let sets = base.join("Movy").join("Sets");
        fs::create_dir_all(&sets).unwrap();
        Fx { base, src, sets }
    }

    impl Fx {
        fn store(&self) -> SetStore { SetStore::new(self.sets.to_str().unwrap()) }
        fn legacy(&self, uuid: &str, payload: &str, chains: &str) {
            SetStore::new(self.src.legacy.to_str().unwrap()).write(uuid, payload, 3, chains).unwrap();
        }
        fn on_page(&self, uuid: &str, name: &str, page: Option<u32>) {
            let dir = match page {
                None => self.src.move_sets.join(uuid),
                Some(p) => self.src.pages[0].join(format!("page_{p}")).join(uuid),
            };
            fs::create_dir_all(dir.join(name)).unwrap();
        }
        fn state(&self, uuid: &str, file: &str, body: &str) {
            let d = self.src.state.join(uuid);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join(file), body).unwrap();
        }
        fn run(&self, lib: &mut Library, force: bool) -> Option<Outcome> {
            migrate(lib, &self.store(), &self.src, force, 1_760_000_000_000, &|_, _| {})
        }
        fn chains(&self, id: &str) -> Vec<Rec> {
            parse_items(&self.store().read_chains(id).expect("chains.json")).unwrap()
                .chunks(FIELDS).map(|c| c.to_vec()).collect()
        }
    }

    const SEQ: &str = "movy1\ncl 0 0 16 0 x\ncl 1 0 16 0 y\n";
    const SLOT: &str = r#"{"name":"Lead","version":1,"modified":false,"chain":{"custom_name":"Lead","input":"both",
        "synth":{"module":"obxd","config":{"state":{"patch":"bass","cut":0.5}},"bypassed":0},
        "audio_fx":[{"type":"mverb","params":{"state":"k=v"},"bypassed":0},
                    {"type":"delay","params":{},"bypassed":1},
                    {"type":"chorus","params":{"state":"x"},"bypassed":0}],
        "lfos":{"lfo1":{"enabled":1,"shape":2,"sync":0,"rate_hz":1.5,"rate_div":4,"depth":0.25,"polarity":1,
                "phase_offset":0,"target":"synth","target_param":"cut","retrigger":0,"division_table_version":2},"lfo2":null}}}"#;
    const CFG: &str = r#"{"slots":[{"name":"","channel":1,"volume":0.5,"forward_channel":-1,"muted":0,"soloed":0},
        {"name":"","channel":2,"volume":1.0,"muted":1}]}"#;

    fn snapshot(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut out = Vec::new();
        fn walk(d: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
            for e in fs::read_dir(d).unwrap().flatten() {
                if e.file_type().unwrap().is_dir() { walk(&e.path(), out); }
                else { out.push((e.path(), fs::read(e.path()).unwrap())); }
            }
        }
        walk(dir, &mut out);
        out.sort();
        out
    }

    #[test]
    fn every_page_is_listed_and_a_shared_name_says_its_page() {
        let f = fx("pages");
        fs::create_dir_all(&f.src.pages[0]).unwrap();
        fs::write(f.src.pages[0].join("current_page.txt"), "2\n").unwrap();
        f.on_page("u-cur", "Set 1", None);
        f.on_page("u-p0", "Set 1", Some(0));
        f.on_page("u-p5", "Set 1", Some(5));
        f.on_page("u-uniq", "Jam", Some(7));
        let sets = move_sets(&f.src);
        assert_eq!(sets.len(), 4);
        assert_eq!(sets.iter().find(|s| s.uuid == "u-cur").unwrap().page, 2, "Sets/ is the current page");
        let n = page_names(&sets);
        assert_eq!(n["u-p0"], "Set 1", "the lowest page keeps the plain name");
        assert_eq!(n["u-cur"], "Set 1 P3");
        assert_eq!(n["u-p5"], "Set 1 P6");
        assert_eq!(n["u-uniq"], "Jam", "a unique name is Move's exactly");
    }

    #[test]
    fn schwung_tracks_level_lfo_and_master_become_one_chains_document() {
        let f = fx("convert");
        f.state("u", "slot_0.json", SLOT);
        f.state("u", "shadow_chain_config.json", CFG);
        f.state("u", "master_fx_0.json", r#"{"module_id":"comp","state":"c=1","lfos":{"lfo1":{"enabled":0,"target":"fx1","target_param":"amt"}}}"#);
        f.state("u", "master_fx_1.json", r#"{"module_id":"eq","bypassed":1}"#);
        let c = convert(None, None, Some(&f.src.state.join("u")));
        let recs: Vec<Rec> = parse_items(&c.chains).unwrap().chunks(FIELDS).map(|c| c.to_vec()).collect();
        let t0: Vec<&Rec> = recs.iter().filter(|r| r[0] == "0").collect();
        assert_eq!(t0.iter().map(|r| r[1].as_str()).collect::<Vec<_>>(), vec!["synth", "fx1"],
                   "bypassed fx2 and the third fx stay behind");
        assert_eq!(t0[0][2], "obxd");
        assert_eq!(t0[0][3], r#"{"patch":"bass","cut":0.5}"#, "a parsed preset is written back as JSON");
        assert_eq!(t0[1][3], "k=v");
        assert_eq!(t0[0][4], "0.5000,0.0000,0,0.0000,0.0000");
        let lfo = parse_items_n(&t0[0][5], 1).unwrap();
        assert_eq!(lfo.len(), 22);
        assert_eq!(&lfo[..11], &["1", "2", "0", "1.5", "4", "0.25", "1", "0", "synth", "cut", "0"]);
        assert!(lfo[11..].iter().all(|v| v.is_empty()), "a null lfo2 is idle");
        assert_eq!(t0[1][4], "", "mix and lfo ride the first component only");
        let mi = master_index().to_string();
        let m: Vec<&Rec> = recs.iter().filter(|r| r[0] == mi).collect();
        assert_eq!(m.iter().map(|r| (r[1].as_str(), r[2].as_str())).collect::<Vec<_>>(),
                   vec![("fx1", "comp"), (IMPORT_MARK, "1")]);
        assert!(!m[0][5].is_empty(), "the master LFOs come from master_fx_0");
        assert!(c.notes.iter().any(|n| n.contains("delay") && n.contains("bypassed")), "{:?}", c.notes);
        assert!(c.notes.iter().any(|n| n.contains("chorus")), "{:?}", c.notes);
    }

    #[test]
    fn what_movy_holds_wins_and_an_already_migrated_set_ignores_its_slots() {
        let f = fx("wins");
        f.state("u", "slot_0.json", SLOT);
        f.state("u", "slot_1.json", &SLOT.replace("obxd", "dexed"));
        let mi = master_index().to_string();
        let own = pack(&["0", "synth", "mine", "", "", "", &mi, "fx1", "lim", "", "", ""]
            .iter().map(|s| s.to_string()).collect::<Vec<_>>());
        let c = convert(Some(&own), None, Some(&f.src.state.join("u")));
        let recs: Vec<Rec> = parse_items(&c.chains).unwrap().chunks(FIELDS).map(|c| c.to_vec()).collect();
        assert_eq!(recs.iter().filter(|r| r[0] == "0").map(|r| r[2].as_str()).collect::<Vec<_>>(), vec!["mine"]);
        assert!(recs.iter().any(|r| r[0] == "1" && r[2] == "dexed"), "an empty track is filled");
        assert!(recs.iter().any(|r| r[0] == mi && r[1] == IMPORT_MARK), "a movy master gets the mark");
        assert!(!recs.iter().any(|r| r[0] == mi && r[2] == "comp"));

        let done = convert(None, Some(r#"{"migv":1}"#), Some(&f.src.state.join("u")));
        assert!(parse_items(&done.chains).unwrap().chunks(FIELDS).all(|r| r[0] == mi),
                "migv: the overtake build already moved these tracks");
    }

    #[test]
    fn chains_kept_only_in_the_ui_mirror_become_chains_json() {
        let ui = r#"{"migv":1,"chains":[{"t":2,"comp":[{"c":"synth","m":"sylph","s":"b\"lob"},{"c":"fx1","m":"rev"}],"mix":"0.8000,0.0000,0"}],
                    "sends":[{"b":1,"m":"delay","s":"d"}]}"#;
        let c = convert(None, Some(ui), None);
        let recs: Vec<Rec> = parse_items(&c.chains).unwrap().chunks(FIELDS).map(|c| c.to_vec()).collect();
        assert_eq!(recs[0], rec(2, "synth", "sylph", "b\"lob", "0.8000,0.0000,0", ""));
        assert_eq!(recs[1], rec(2, "fx1", "rev", "", "", ""));
        assert_eq!(recs[2], rec(send_index(1), SEND_COMPONENT, "delay", "d", "", ""));
    }

    #[test]
    fn first_run_imports_all_pages_once_and_leaves_every_source_alone() {
        let f = fx("first");
        f.legacy("u-movy", SEQ, "0\n");
        f.on_page("u-movy", "Set 1", Some(0));
        f.state("u-sch", "slot_0.json", SLOT);
        f.on_page("u-sch", "Set 1", Some(4));
        f.state("u-dead", "slot_0.json", SLOT);   // deleted in Move: on no page
        f.on_page("u-native", "Move only", None);  // nothing movy or schwung could bring
        let before = (snapshot(&f.src.legacy), snapshot(&f.src.state));
        let mut lib = Library::default();
        let out = f.run(&mut lib, false).expect("first run");
        assert_eq!(out.n, 2);
        let name = |id: &str| lib.sets.iter().find(|e| e.id == id).map(|e| e.name.clone());
        assert_eq!(name("u-movy").as_deref(), Some("Set 1"));
        assert_eq!(name("u-sch").as_deref(), Some("Set 1 P5"));
        assert!(name("u-dead").is_none() && name("u-native").is_none());
        assert_eq!(f.store().read_best("u-movy").unwrap().payload, SEQ);
        assert!(f.store().read_best("u-sch").is_some(), "a schwung-only Set gets a sequence file to open");
        assert!(f.chains("u-sch").iter().any(|r| r[0] == "0" && r[2] == "obxd"));
        assert_eq!((snapshot(&f.src.legacy), snapshot(&f.src.state)), before, "sources untouched");
        assert!(lib.migrated > 0);

        f.legacy("u-later", SEQ, "0\n");
        assert!(f.run(&mut lib, false).is_none(), "never again on its own");
        assert!(!lib.sets.iter().any(|e| e.id == "u-later"));
    }

    #[test]
    fn an_earlier_import_is_filled_and_a_deleted_one_stays_deleted() {
        let f = fx("fill");
        f.legacy("u-kept", SEQ, "0\n");
        f.on_page("u-kept", "Kept", Some(1));
        f.state("u-kept", "slot_3.json", SLOT);
        f.legacy("u-gone", SEQ, "0\n");
        f.on_page("u-gone", "Gone", Some(1));
        /* What the import before this one left: u-kept copied, u-gone deleted. */
        let store = f.store();
        store.write("u-kept", "movy1\nedited\n", 9, "0\n").unwrap();
        let mut lib = Library { imported: vec!["u-kept".into(), "u-gone".into()], ..Default::default() };
        lib.sets.push(Entry { id: "u-kept".into(), name: "Renamed".into(), created: 1, parent: None,
                              legacy: Some("u-kept".into()), clips: 0 });
        f.run(&mut lib, false).unwrap();
        assert_eq!(lib.sets.len(), 1, "a deleted import does not come back on its own");
        assert_eq!(lib.sets[0].name, "Renamed", "the automatic run keeps the user's name");
        assert_eq!(store.read_best("u-kept").unwrap().payload, "movy1\nedited\n", "and the user's sequence");
        assert!(f.chains("u-kept").iter().any(|r| r[0] == "3" && r[2] == "obxd"), "schwung's track arrives");
        assert!(read_index(&store, "u-kept").v.iter().any(|v| v.why == Why::PreRestore),
                "and the Set as it was is a version first");
    }

    #[test]
    fn the_manual_run_replaces_only_sets_from_move_and_keeps_a_version_first() {
        let f = fx("force");
        f.legacy("u-a", SEQ, "0\n");
        fs::write(f.src.legacy.join("u-a").join("ui-state.json"), r#"{"oct":[3]}"#).unwrap();
        f.on_page("u-a", "Set A", None);
        let mut lib = Library::default();
        f.run(&mut lib, false).unwrap();
        let store = f.store();
        store.write("u-a", "movy1\nmy edits\n", 40, "0\n").unwrap();
        lib.sets[0].name = "Renamed".into();
        lib.sets.push(Entry { id: "mine".into(), name: "Made in movy".into(), created: 5, parent: None,
                              legacy: None, clips: 0 });
        store.write("mine", "movy1\nmine\n", 2, "0\n").unwrap();
        lib.imported.push("u-deleted".into());
        f.legacy("u-deleted", SEQ, "0\n");

        let out = f.run(&mut lib, true).expect("manual runs always run");
        assert_eq!(out.replaced.len(), 1);
        let r = &out.replaced[0];
        assert_eq!((r.id.as_str(), r.payload.as_str()), ("u-a", SEQ));
        assert!(r.gen > 40, "above everything on disk");
        assert_eq!(store.read_best("u-a").unwrap().payload, SEQ);
        assert_eq!(lib.sets.iter().find(|e| e.id == "u-a").unwrap().name, "Set A", "Move's name again");
        let kept = read_index(&store, "u-a").v;
        assert!(kept.iter().any(|v| v.why == Why::PreRestore), "the replaced state is a version");
        assert_eq!(store.read_best("mine").unwrap().payload, "movy1\nmine\n", "a movy Set is never touched");
        assert!(lib.sets.iter().any(|e| e.id == "u-deleted"), "the manual run brings a deleted import back");
    }

    #[test]
    fn placeholders_are_recovered_and_blank_sets_skipped() {
        let f = fx("recover");
        f.legacy("_default", SEQ, "0\n");
        f.legacy("__pending-9-2", SEQ, "0\n");
        fs::create_dir_all(f.src.legacy.join("u-empty")).unwrap();
        fs::write(f.src.legacy.join("u-empty").join("ui-state.json"), "{}").unwrap();
        let mut lib = Library::default();
        assert_eq!(f.run(&mut lib, false).unwrap().n, 2);
        let ids: Vec<&str> = lib.sets.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"r-default") && ids.contains(&"r--pending-9-2"), "{ids:?}");
        assert!(lib.sets.iter().all(|e| e.name.starts_with("Recovered ")));
        let _ = &f.base;
    }

    #[test]
    fn dates_are_civil_utc() {
        assert_eq!(date_of(0), "1970-01-01");
        assert_eq!(date_of(1_709_164_800_000), "2024-02-29");
    }
}
