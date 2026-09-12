//! The saver thread: every byte of a Set's files moves through here.
//!
//! **Nothing in this module's I/O runs on the audio thread.** `set_param`,
//! `get_param` and `render_block` all do, and a cold `dlopen` already holds
//! that thread for 78-276 ms — schwung has been moving file work off it for
//! exactly this reason (`shadow_set_pages.c:411`), and davebox writing its
//! state file inline from `set_param` is the shape we are deliberately not
//! copying.
//!
//! The lock discipline that makes the audio side safe: **the mutex is never
//! held across file I/O.** The worker reads or writes first and locks only to
//! publish a few fields, so an audio-thread `status()` waits microseconds at
//! worst.
//!
//! What crosses the wire is a COMMAND, never a payload. A lost command is
//! harmless and idempotent on retry — an engine that has not opened a Set
//! cannot overwrite one — where the `state` push this replaces destroyed data
//! when it was lost (docs/persistence-hazards.md §2).

use crate::set_envelope::BLANK_STATE;
use crate::set_store::SetStore;
use crate::version_index::Why;
use crate::version_store::{read_index, wire_rows, write_version, Capture};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// ~10 minutes. The autosave runs every few seconds forever, so `auto` needs a
/// floor or the history is just the rotation with extra steps.
const VERSION_MIN_MS: u64 = 600_000;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

pub enum Job {
    Open { uuid: String, seed: Option<String> },
    Rename { from: String, to: String },
    Blank { uuid: String },
    Save { uuid: String, payload: String, gen: u32, chains: String },
    /// The one capture that is a command: a teardown or a Set switch, where
    /// the UI knows a boundary has been reached and the engine does not.
    Keep { uuid: String, why: Why },
    /// Put a kept version back. The UI names `n` from the menu it was served.
    Restore { uuid: String, n: u32 },
    Flush,
}

enum Msg {
    Work(Job),
    /// Test-only rendezvous: the worker answers once every earlier job is done.
    Sync(Sender<()>),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Opening,
    Ready,
    Failed,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Opening => "opening",
            Phase::Ready => "ready",
            Phase::Failed => "failed",
        }
    }
}

struct Shared {
    uuid: String,
    phase: Phase,
    gen: u32,
    reason: String,
    /// Outstanding saves. The UI's `flush` waits for this to reach zero.
    dirty: u32,
    /// Bytes for the audio thread to apply: (payload, chains, gen).
    loaded: Option<(String, String, u32)>,
    /// The menu, already formatted. `get_param` runs on the audio thread, so
    /// what it serves must already be a string.
    versions: String,
    /// The restored version's ui half, waiting for the UI: `pending` while the
    /// job is queued, `none` when the version has no ui half or the answer has
    /// already been taken, `failed` when the restore did not happen, otherwise
    /// the bytes. The UI owns `ui-state.json` (spec §5), so the engine hands
    /// the bytes back rather than writing that file.
    vui: String,
}

pub struct Saver {
    tx: Sender<Msg>,
    shared: Arc<Mutex<Shared>>,
}

/// Total by construction: this runs on the audio thread, and a malformed
/// command must be ignored rather than panic inside someone else's callback.
pub fn parse_cmd(val: &str, cur: &str) -> Option<Job> {
    let mut it = val.split_whitespace();
    match it.next()? {
        "open" => {
            let uuid = it.next()?.to_string();
            let seed = it.next().and_then(|t| t.strip_prefix("seed=")).map(|s| s.to_string());
            Some(Job::Open { uuid, seed })
        }
        "rename" => {
            let from = it.next()?.to_string();
            let to = it.next()?.to_string();
            Some(Job::Rename { from, to })
        }
        "blank" => Some(Job::Blank { uuid: it.next()?.to_string() }),
        /* The Set is the one the engine already has open: a capture command
         * naming a different Set would be a command to capture a Set nobody is
         * editing. */
        "keep" => Some(Job::Keep { uuid: cur.to_string(), why: Why::from_str(it.next()?)? }),
        "restore" => Some(Job::Restore { uuid: cur.to_string(), n: it.next()?.parse().ok()? }),
        "flush" => Some(Job::Flush),
        _ => None,
    }
}

/// Keep a version, and republish the menu. `ui` comes from the Set's own file:
/// that half is the UI's to write (spec §5) and the engine's only to copy.
fn capture(store: &SetStore, shared: &Arc<Mutex<Shared>>, uuid: &str, why: Why,
           payload: &str, gen: u32, chains: Option<&str>) {
    let ui = std::fs::read_to_string(store.set_dir(uuid).join("ui-state.json")).ok();
    let c = Capture { why, payload, gen, chains, ui: ui.as_deref(), now: now_ms() };
    if !write_version(store, uuid, &c) {
        /* Logged and dropped. The Set's CURRENT state outranks its history, so
         * a capture never fails the save it rode in on. */
        crate::host::log(&format!("versions: {} capture dropped for {uuid}", why.as_str()));
    }
    publish_versions(store, shared, uuid);
}

fn publish_versions(store: &SetStore, shared: &Arc<Mutex<Shared>>, uuid: &str) {
    let rows = wire_rows(&read_index(store, uuid));
    shared.lock().unwrap().versions = rows;
}

/// Seed a Set's history from what earlier builds left in the rotation.
///
/// A no-op once the Set has an index — this runs on every open. Adoption
/// COPIES: the shadows are live rotation slots, so adopting them by reference
/// would mean the history evaporates on the very next autosave.
fn adopt_existing(store: &SetStore, shared: &Arc<Mutex<Shared>>, uuid: &str) {
    if !read_index(store, uuid).v.is_empty() {
        return;
    }
    let mut found: Vec<(String, u32)> = Vec::new();
    for path in [store.state_path(uuid), store.shadow_path(uuid, 1), store.shadow_path(uuid, 2)] {
        let Some(p) = std::fs::read_to_string(path).ok().and_then(|s| crate::set_envelope::parse(&s)) else { continue };
        if found.iter().any(|(payload, _)| *payload == p.payload) {
            continue;
        }
        found.push((p.payload, p.gen));
    }
    if found.is_empty() {
        return;
    }
    found.sort_by_key(|(_, gen)| *gen);   // oldest gets the lowest n
    let chains = store.read_chains(uuid);
    for (i, (payload, gen)) in found.iter().enumerate() {
        /* Only the NEWEST adopted version gets today's chains and ui blob.
         * There is exactly one of each on disk — they were never rotated — so
         * giving an older sequence today's instruments would be a quiet lie.
         * An older adopted version restores the sequence alone, which the menu
         * shows as SEQ ONLY. */
        let newest = i == found.len() - 1;
        let ui = if newest {
            std::fs::read_to_string(store.set_dir(uuid).join("ui-state.json")).ok()
        } else {
            None
        };
        write_version(store, uuid, &Capture {
            why: Why::Adopted, payload, gen: *gen,
            chains: if newest { chains.as_deref() } else { None },
            ui: ui.as_deref(), now: 0,
        });
    }
    publish_versions(store, shared, uuid);
}

fn do_open(store: &SetStore, shared: &Arc<Mutex<Shared>>, uuid: &str, seed: Option<&str>) {
    /* A seed is a FALLBACK, never a preference: a Set that owns state keeps it.
     * Reversed, opening a copy would overwrite the copy's own work with its
     * source's. */
    if !store.has_state(uuid) {
        if let Some(src) = seed {
            store.seed(uuid, src);
        }
    }

    /* Before movy can write anything to this Set: adopt whatever earlier builds
     * left behind, then snapshot what is actually on disk. This one capture is
     * what makes a Set that comes up blank a menu entry rather than a loss. */
    adopt_existing(store, shared, uuid);
    if let Some(p) = store.read_best(uuid) {
        capture(store, shared, uuid, Why::Open, &p.payload, p.gen, store.read_chains(uuid).as_deref());
    } else {
        publish_versions(store, shared, uuid);
    }

    let had_files = store.has_state(uuid);
    let best = store.read_best(uuid);
    let mut sh = shared.lock().unwrap();
    sh.uuid = uuid.to_string();
    match best {
        Some(p) => {
            sh.gen = p.gen;
            sh.phase = Phase::Ready;
            sh.reason.clear();
            sh.loaded = Some((p.payload, store.read_chains(uuid).unwrap_or_default(), p.gen));
        }
        /* Files that exist but do not parse are NOT an empty Set. Reading them
         * as one is how a Set gets blanked; the UI's recovery is scoped to a
         * set-level failure precisely so it can offer that choice instead of
         * making it. */
        None if had_files => {
            sh.phase = Phase::Failed;
            sh.reason = "unreadable".to_string();
            sh.loaded = None;
        }
        None => {
            sh.gen = 0;
            sh.phase = Phase::Ready;
            sh.reason.clear();
            sh.loaded = None;
        }
    }
}

fn worker(root: String, shared: Arc<Mutex<Shared>>, rx: std::sync::mpsc::Receiver<Msg>) {
    let store = SetStore::new(&root);
    /* The `auto` cadence, owned by the thread that captures. It starts at the
     * open capture: without that it is still 0 when the first autosave lands
     * ~8 s later, and a session opened and played into records its second
     * version within seconds of its first — the rotation's job, not history's. */
    let mut last_auto_ms = 0u64;
    while let Ok(msg) = rx.recv() {
        match msg {
            Msg::Sync(ack) => {
                let _ = ack.send(());
            }
            Msg::Work(Job::Open { uuid, seed }) => {
                do_open(&store, &shared, &uuid, seed.as_deref());
                last_auto_ms = now_ms();
            }
            Msg::Work(Job::Rename { from, to }) => {
                /* The id changed but the Set did not, so the work in hand moves
                 * with it. Seeding is a no-op when the destination already owns
                 * state, which is the safe direction. */
                if !store.has_state(&to) {
                    store.seed(&to, &from);
                }
                let mut sh = shared.lock().unwrap();
                sh.uuid = to;
            }
            Msg::Work(Job::Blank { uuid }) => {
                /* Unconditional, and before the files go: what is about to be
                 * overwritten may be the only copy, and "it looked the same as
                 * the last version" is not a reason to find out afterwards. */
                if let Some(p) = store.read_best(&uuid) {
                    capture(&store, &shared, &uuid, Why::PreWipe, &p.payload, p.gen,
                            store.read_chains(&uuid).as_deref());
                }
                /* The deliberate exception to "a blank Set writes nothing": the
                 * state files must GO, or reopening restores exactly what the
                 * user asked to be rid of. The history is NOT state — it is the
                 * record of what was destroyed, and it stays. */
                store.blank_files(&uuid);
                let mut sh = shared.lock().unwrap();
                sh.gen = 0;
                sh.phase = Phase::Ready;
                sh.reason.clear();
                sh.loaded = Some((BLANK_STATE.to_string(), "0\n".to_string(), 0));
            }
            Msg::Work(Job::Save { uuid, payload, gen, chains }) => {
                let res = store.write(&uuid, &payload, gen, &chains);
                /* Scoped so the lock is released before the capture below: the
                 * mutex is never held across file I/O, or an audio-thread
                 * `status()` would wait on a write. */
                let saved = {
                    let mut sh = shared.lock().unwrap();
                    sh.dirty = sh.dirty.saturating_sub(1);
                    match &res {
                        Ok(()) => {
                            sh.gen = gen;
                            sh.reason.clear();
                        }
                        /* Left for the next save to retry. The engine keeps the
                         * bytes — unlike the old path, where reading `state` out
                         * of the engine cleared its dirty flag and a failed write
                         * was then lost for good. */
                        Err(e) => {
                            crate::host::log(&format!("set: save failed: {e}"));
                            sh.reason = "save-failed".to_string();
                        }
                    }
                    res.is_ok()
                };
                /* Rides the save that just landed, so the history costs no
                 * extra read — and is rate-limited here, because this arm runs
                 * every few seconds for as long as movy is open. */
                if saved && (last_auto_ms == 0 || now_ms() - last_auto_ms >= VERSION_MIN_MS) {
                    capture(&store, &shared, &uuid, Why::Auto, &payload, gen, Some(&chains));
                    /* Set even when the capture was dropped: the interval is
                     * about how often we ASK, not how often we succeed. */
                    last_auto_ms = now_ms();
                }
            }
            Msg::Work(Job::Restore { uuid, n }) => {
                let Some(src) = crate::version_store::read_state(&store, &uuid, n) else {
                    crate::host::log(&format!("versions: cannot restore {n} of {uuid}"));
                    shared.lock().unwrap().vui = "failed".to_string();
                    continue;
                };
                /* Before anything is overwritten: a mis-press must not cost the
                 * live take, so a restore is itself undoable. */
                let cur = store.read_best(&uuid);
                if let Some(c) = &cur {
                    capture(&store, &shared, &uuid, Why::PreRestore, &c.payload, c.gen,
                            store.read_chains(&uuid).as_deref());
                }
                /* Above every copy AND every version, so nothing on disk can
                 * outrank the restore — including the capture just taken. */
                let mut top = cur.map_or(0, |c| c.gen);
                for r in &read_index(&store, &uuid).v {
                    if r.gen > top {
                        top = r.gen;
                    }
                }
                let gen = top + 1;
                /* The version's own chains, not today's: restoring the sequence
                 * under the instruments that replaced it is the loss `ch`
                 * exists to prevent. A version that carries none leaves the
                 * chains alone, which the menu shows as SEQ ONLY. */
                let chains = crate::version_store::read_chains(&store, &uuid, n)
                    .or_else(|| store.read_chains(&uuid))
                    .unwrap_or_else(|| "0\n".to_string());
                let ui = crate::version_store::read_ui(&store, &uuid, n);
                match store.write(&uuid, &src.payload, gen, &chains) {
                    Ok(()) => {
                        crate::host::log(&format!("versions: restored {n} of {uuid} at gen {gen}"));
                        let mut sh = shared.lock().unwrap();
                        sh.gen = gen;
                        sh.loaded = Some((src.payload, chains, gen));
                        sh.vui = ui.unwrap_or_else(|| "none".to_string());
                    }
                    Err(e) => {
                        crate::host::log(&format!("versions: restore of {n} did not reach disk: {e}"));
                        shared.lock().unwrap().vui = "failed".to_string();
                    }
                }
                publish_versions(&store, &shared, &uuid);
            }
            Msg::Work(Job::Keep { uuid, why }) => {
                if let Some(p) = store.read_best(&uuid) {
                    capture(&store, &shared, &uuid, why, &p.payload, p.gen,
                            store.read_chains(&uuid).as_deref());
                }
            }
            Msg::Work(Job::Flush) => {}
        }
    }
}

impl Saver {
    pub fn new(root: &str) -> Self {
        let (tx, rx) = channel();
        let shared = Arc::new(Mutex::new(Shared {
            uuid: String::new(),
            phase: Phase::Opening,
            gen: 0,
            reason: String::new(),
            dirty: 0,
            loaded: None,
            versions: String::new(),
            vui: "none".to_string(),
        }));
        let w = Arc::clone(&shared);
        let root = root.to_string();
        std::thread::spawn(move || worker(root, w, rx));
        Saver { tx, shared }
    }

    pub fn submit(&self, job: Job) {
        /* Counted BEFORE the send, so a status read between submit and the
         * worker picking it up still reports the Set as un-saved. */
        if matches!(job, Job::Save { .. }) {
            self.shared.lock().unwrap().dirty += 1;
        }
        /* Marked before the send, so a UI that reads the answer between the
         * command and the worker picking it up sees `pending` rather than the
         * previous restore's verdict. */
        if matches!(job, Job::Restore { .. }) {
            self.shared.lock().unwrap().vui = "pending".to_string();
        }
        let _ = self.tx.send(Msg::Work(job));
    }

    pub fn status(&self) -> String {
        let sh = self.shared.lock().unwrap();
        let mut s = format!(
            "uuid={} phase={} gen={} dirty={}",
            sh.uuid,
            sh.phase.as_str(),
            sh.gen,
            if sh.dirty > 0 { 1 } else { 0 }
        );
        if !sh.reason.is_empty() {
            s.push_str(&format!(" reason={}", sh.reason));
        }
        s
    }

    pub fn versions(&self) -> String {
        self.shared.lock().unwrap().versions.clone()
    }

    /// The restored version's ui half — taken once, so a verdict is never read
    /// as a second restore's.
    pub fn vui(&self) -> String {
        let mut sh = self.shared.lock().unwrap();
        if sh.vui == "pending" {
            return sh.vui.clone();
        }
        std::mem::replace(&mut sh.vui, "none".to_string())
    }

    /// Bytes waiting to be applied, taken exactly once.
    pub fn take_loaded(&self) -> Option<(String, String, u32)> {
        self.shared.lock().unwrap().loaded.take()
    }

    #[cfg(test)]
    pub fn drain_for_test(&self) {
        let (ack, done) = channel();
        let _ = self.tx.send(Msg::Sync(ack));
        let _ = done.recv();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> String {
        let d = std::env::temp_dir().join(format!("movy-saver-{name}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.to_str().unwrap().to_string()
    }

    fn versions_of(root: &str, uuid: &str) -> Vec<crate::version_index::VersionRec> {
        crate::version_store::read_index(&SetStore::new(root), uuid).v
    }

    /* The capture that makes a Set coming up blank a menu entry rather than a
     * loss: a snapshot of what was on disk BEFORE movy can write anything. */
    #[test]
    fn opening_a_set_keeps_what_was_on_disk() {
        let root = tmp("openkeep");
        /* Seeded through the store rather than a Save job: a save that arrives
         * before any open finds the auto cadence still at zero and captures
         * immediately, which is correct — the UI always opens first — but it
         * would put a second version in the way of what this test is about. */
        SetStore::new(&root).write("u1", "movy1\ncl 0 0 16 0 x\n", 1, "0\n").unwrap();
        let s = Saver::new(&root);
        s.submit(Job::Open { uuid: "u1".into(), seed: None });
        s.drain_for_test();
        let v = versions_of(&root, "u1");
        /* Two, and the pair is the point: a Set with files and no index looks
         * exactly like one an earlier build wrote, so the rotation is adopted
         * first and the open capture lands on top of it. */
        assert_eq!(v.len(), 2, "got {v:?}");
        assert_eq!(v[0].why, Why::Open);
        assert_eq!(v[1].why, Why::Adopted);
        assert_eq!(crate::version_store::read_state(&SetStore::new(&root), "u1", v[0].n).unwrap().payload,
                   "movy1\ncl 0 0 16 0 x\n", "the open capture is what was on disk");
    }

    /* A Set with nothing on disk has nothing to keep. A version per visited
     * pad is how a history becomes noise. */
    #[test]
    fn opening_an_empty_set_keeps_nothing() {
        let root = tmp("openempty");
        let s = Saver::new(&root);
        s.submit(Job::Open { uuid: "u1".into(), seed: None });
        s.drain_for_test();
        assert_eq!(versions_of(&root, "u1").len(), 0);
    }

    /* What earlier builds left behind is adopted once, oldest first, and
     * COPIED: the shadows are live rotation slots, so adopting by reference
     * would mean the history evaporates on the very next autosave. */
    #[test]
    fn an_older_set_adopts_its_rotation_once() {
        let root = tmp("adopt");
        let store = SetStore::new(&root);
        std::fs::create_dir_all(store.set_dir("old")).unwrap();
        std::fs::write(store.state_path("old"), crate::set_envelope::wrap("movy1\ncl 0 0 16 0 a\n", 4)).unwrap();
        std::fs::write(store.shadow_path("old", 1), crate::set_envelope::wrap("movy1\ncl 0 0 16 0 b\n", 3)).unwrap();

        let s = Saver::new(&root);
        s.submit(Job::Open { uuid: "old".into(), seed: None });
        s.drain_for_test();
        let v = versions_of(&root, "old");
        let adopted: Vec<_> = v.iter().filter(|r| r.why == Why::Adopted).collect();
        assert_eq!(adopted.len(), 2, "both distinct copies");
        assert!(adopted.iter().any(|r| r.gen == 3), "the shadow was adopted at its own generation");

        let s2 = Saver::new(&root);
        s2.submit(Job::Open { uuid: "old".into(), seed: None });
        s2.drain_for_test();
        assert_eq!(versions_of(&root, "old").iter().filter(|r| r.why == Why::Adopted).count(), 2,
                   "adoption is a no-op after the first open");
    }

    /* The autosave runs every few seconds forever. Without a floor the history
     * is just the rotation with extra steps. */
    #[test]
    fn the_autosave_capture_is_rate_limited() {
        let root = tmp("auto");
        let s = Saver::new(&root);
        for i in 1..=5u32 {
            s.submit(Job::Save {
                uuid: "u1".into(),
                payload: format!("movy1\ncl 0 0 16 0 {i}\n"),
                gen: i, chains: "0\n".into(),
            });
        }
        s.drain_for_test();
        assert_eq!(versions_of(&root, "u1").iter().filter(|r| r.why == Why::Auto).count(), 1,
                   "five saves inside the window are one version");
    }

    /* The capture the whole history exists for — and the trap the port
     * creates: Blank used to take the Set's whole directory, which would
     * delete the history at the one moment it matters. */
    #[test]
    fn blanking_keeps_the_history_it_just_captured() {
        let root = tmp("blank");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 x\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Blank { uuid: "u1".into() });
        s.drain_for_test();

        let store = SetStore::new(&root);
        assert!(!store.has_state("u1"), "the state files must be gone");
        let v = versions_of(&root, "u1");
        assert!(v.iter().any(|r| r.why == Why::PreWipe),
                "the pre-wipe capture must survive the wipe: {v:?}");
        assert_eq!(crate::version_store::read_state(&store, "u1", v[0].n).unwrap().payload,
                   "movy1\ncl 0 0 16 0 x\n");
    }

    /* A teardown or a Set switch is the last chance this Set has to record
     * where it got to. It is the one capture that is a command. */
    #[test]
    fn keep_exit_captures_the_current_state() {
        let root = tmp("keepexit");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 x\n".into(), gen: 2, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.drain_for_test();
        assert!(versions_of(&root, "u1").iter().any(|r| r.why == Why::Exit));
    }

    #[test]
    fn the_wire_rows_are_published_without_a_file_read() {
        let root = tmp("pub");
        SetStore::new(&root).write("u1", "movy1\ncl 0 0 16 0 x\n", 1, "0\n").unwrap();
        let s = Saver::new(&root);
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.drain_for_test();
        let rows = s.versions();
        assert_eq!(rows.lines().count(), 1, "got {rows:?}");
        assert!(rows.contains(" exit "), "got {rows:?}");
    }

    /* A restore must win an ordinary read afterwards — including against the
     * pre-restore capture just taken. A hand-copy that does NOT bump the
     * generation loses to a newer blank in a shadow; that is what a device
     * showed, and why MANUAL.md tells anyone recovering by hand to overwrite
     * every copy. */
    #[test]
    fn a_restore_outranks_everything_on_disk() {
        let root = tmp("restore");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 old\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 new\n".into(), gen: 9, chains: "0\n".into() });
        s.drain_for_test();
        let n = versions_of(&root, "u1")[0].n;

        s.submit(Job::Restore { uuid: "u1".into(), n });
        s.drain_for_test();

        let store = SetStore::new(&root);
        let best = store.read_best("u1").expect("reads");
        assert_eq!(best.payload, "movy1\ncl 0 0 16 0 old\n");
        assert!(best.gen > 9, "the restore must outrank the newest generation: {}", best.gen);
    }

    /* A mis-press must not cost the live take: the restore is itself undoable. */
    #[test]
    fn a_restore_keeps_what_it_replaced() {
        let root = tmp("prerestore");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 a\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 live\n".into(), gen: 5, chains: "0\n".into() });
        s.drain_for_test();
        let n = versions_of(&root, "u1").iter().find(|r| r.why == Why::Exit).unwrap().n;

        s.submit(Job::Restore { uuid: "u1".into(), n });
        s.drain_for_test();
        let pre = versions_of(&root, "u1").into_iter().find(|r| r.why == Why::PreRestore)
            .expect("the live take was kept");
        assert_eq!(crate::version_store::read_state(&SetStore::new(&root), "u1", pre.n).unwrap().payload,
                   "movy1\ncl 0 0 16 0 live\n");
    }

    /* The restored bytes reach the audio thread the same way an open's do. */
    #[test]
    fn a_restore_publishes_what_the_engine_must_apply() {
        let root = tmp("restoreapply");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 a\n".into(), gen: 1, chains: "7\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 b\n".into(), gen: 4, chains: "0\n".into() });
        s.drain_for_test();
        let n = versions_of(&root, "u1").iter().find(|r| r.why == Why::Exit).unwrap().n;
        let _ = s.take_loaded();

        s.submit(Job::Restore { uuid: "u1".into(), n });
        s.drain_for_test();
        let (payload, chains, _gen) = s.take_loaded().expect("the restore must publish its bytes");
        assert_eq!(payload, "movy1\ncl 0 0 16 0 a\n");
        assert_eq!(chains, "7\n", "and the chains that were live with it");
    }

    /* An adopted OLDER sequence has no ui half, and overwriting the keyboard
     * and chains with nothing would be worse than the wipe this feature exists
     * to undo. `none` is the whole answer. */
    #[test]
    fn a_version_with_no_ui_half_answers_none() {
        let root = tmp("restorenoui");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 a\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.drain_for_test();
        let n = versions_of(&root, "u1")[0].n;
        s.submit(Job::Restore { uuid: "u1".into(), n });
        s.drain_for_test();
        assert_eq!(s.vui(), "none");
    }

    #[test]
    fn a_restore_of_a_version_that_is_gone_says_so() {
        let root = tmp("restoremiss");
        let s = Saver::new(&root);
        s.submit(Job::Restore { uuid: "u1".into(), n: 7 });
        s.drain_for_test();
        assert_eq!(s.vui(), "failed");
        /* Taken once: a stale verdict must not be read as a second failure. */
        assert_eq!(s.vui(), "none");
    }

    #[test]
    fn parses_the_restore_command() {
        assert!(matches!(parse_cmd("restore 4", "u1"), Some(Job::Restore { n: 4, .. })));
        assert!(parse_cmd("restore", "u1").is_none());
        assert!(parse_cmd("restore x", "u1").is_none());
    }

    #[test]
    fn parses_the_keep_command() {
        assert!(matches!(parse_cmd("keep exit", "u1"), Some(Job::Keep { why: Why::Exit, .. })));
        assert!(parse_cmd("keep nonsense", "u1").is_none());
        assert!(parse_cmd("keep", "u1").is_none());
    }

    /* Commands are parsed on the audio thread and executed on the saver
     * thread, so parsing must be total: an unknown or malformed command is
     * ignored, never a panic in someone else's audio callback. */
    #[test]
    fn parses_every_command() {
        assert!(matches!(parse_cmd("open abc", ""), Some(Job::Open { .. })));
        assert!(matches!(parse_cmd("open abc seed=def", ""), Some(Job::Open { seed: Some(_), .. })));
        assert!(matches!(parse_cmd("rename a b", ""), Some(Job::Rename { .. })));
        assert!(matches!(parse_cmd("blank a", ""), Some(Job::Blank { .. })));
        assert!(matches!(parse_cmd("flush", ""), Some(Job::Flush)));
        assert!(parse_cmd("open", "").is_none());
        assert!(parse_cmd("nonsense a b c", "").is_none());
        assert!(parse_cmd("", "").is_none());
    }

    #[test]
    fn open_of_an_unknown_set_reports_ready_with_no_state() {
        let s = Saver::new(&tmp("unknown"));
        s.submit(Job::Open { uuid: "u1".into(), seed: None });
        s.drain_for_test();
        let st = s.status();
        assert!(st.contains("uuid=u1"), "got {st}");
        assert!(st.contains("phase=ready"), "got {st}");
        assert!(s.take_loaded().is_none(), "no state means nothing to apply");
    }

    #[test]
    fn a_saved_set_comes_back_on_open() {
        let root = tmp("roundtrip");
        let s = Saver::new(&root);
        s.submit(Job::Save {
            uuid: "u1".into(),
            payload: "movy1\nbpm 12000\n".into(),
            gen: 1,
            chains: "0\n".into(),
        });
        s.submit(Job::Flush);
        s.drain_for_test();

        let s2 = Saver::new(&root);
        s2.submit(Job::Open { uuid: "u1".into(), seed: None });
        s2.drain_for_test();
        let (payload, _chains, gen) = s2.take_loaded().expect("loaded");
        assert_eq!(payload, "movy1\nbpm 12000\n");
        assert_eq!(gen, 1);
    }

    /* The UI's only recovery is to blank the Set, which is scoped to a
     * set-level failure — it cannot fix an engine that never started, and it
     * would destroy a Set that is perfectly fine. So an open that fails must
     * SAY it failed rather than looking like an empty Set. */
    #[test]
    fn an_unreadable_set_reports_failed_with_a_reason() {
        let root = tmp("failed");
        let s = Saver::new(&root);
        std::fs::create_dir_all(format!("{root}/u1")).unwrap();
        std::fs::write(format!("{root}/u1/seq-state.json"), "movy1\ngen 4\ntorn").unwrap();
        s.submit(Job::Open { uuid: "u1".into(), seed: None });
        s.drain_for_test();
        let st = s.status();
        assert!(st.contains("phase=failed"), "got {st}");
        assert!(st.contains("reason="), "got {st}");
    }

    #[test]
    fn dirty_clears_once_the_save_has_landed() {
        let s = Saver::new(&tmp("dirty"));
        s.submit(Job::Save {
            uuid: "u1".into(),
            payload: "movy1\nbpm 12000\n".into(),
            gen: 1,
            chains: "0\n".into(),
        });
        assert!(s.status().contains("dirty=1"), "got {}", s.status());
        s.drain_for_test();
        assert!(s.status().contains("dirty=0"), "got {}", s.status());
    }

    /* A seed is how copy-on-inherit survives the move: the UI names the source
     * by name policy, the engine copies the bytes. */
    #[test]
    fn open_with_a_seed_inherits_when_the_set_has_nothing() {
        let root = tmp("seed");
        let s = Saver::new(&root);
        s.submit(Job::Save {
            uuid: "src".into(),
            payload: "movy1\nbpm 15000\n".into(),
            gen: 3,
            chains: "0\n".into(),
        });
        s.submit(Job::Open { uuid: "copy".into(), seed: Some("src".into()) });
        s.drain_for_test();
        let (payload, _c, gen) = s.take_loaded().expect("loaded");
        assert_eq!(payload, "movy1\nbpm 15000\n");
        assert_eq!(gen, 1, "an inherited Set starts its own generation sequence");
    }

    /* A Set that owns state must NOT be overwritten by a seed — the seed is a
     * fallback, never a preference. */
    #[test]
    fn a_seed_never_beats_the_sets_own_state() {
        let root = tmp("seedown");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "src".into(), payload: "movy1\nbpm 15000\n".into(), gen: 3, chains: "0\n".into() });
        s.submit(Job::Save { uuid: "own".into(), payload: "movy1\nbpm 90000\n".into(), gen: 2, chains: "0\n".into() });
        s.submit(Job::Open { uuid: "own".into(), seed: Some("src".into()) });
        s.drain_for_test();
        assert_eq!(s.take_loaded().expect("loaded").0, "movy1\nbpm 90000\n");
    }
}
