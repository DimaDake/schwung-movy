//! Private module trees, so two chains holding one module stop sharing its
//! `.data`/`.bss`.
//!
//! `dlopen` dedups by `(st_dev, st_ino)` — not by path — so two chains loading
//! the same `dsp.so` get ONE writable mapping and race on every file-scope
//! variable the module mutates from `render_block`. Proven on device in
//! `plans/2026-08-22-module-isolation.md` §1. **A symlink or hard link does not
//! help**: both resolve to the same inode. Only a byte copy separates them.
//!
//! movy owns the whole address space the chain host resolves against, because
//! `create_instance(module_dir, ...)` is movy's call and every path the chain
//! host builds is textual from it:
//!
//! ```text
//! synth     <module_dir>/../sound_generators/<name>/dsp.so   chain_host.c:392,431
//! audio FX  <module_dir>/../audio_fx/<name>/<name>.so        chain_host.c:260
//! MIDI FX   <module_dir>/../midi_fx/<name>/dsp.so            chain_midi.c:240
//! patches   <module_dir>/../../patches                       chain_patch.c:80
//! ```
//!
//! Two parent levels are live, so the mirror reproduces both. **`modules/chain`
//! has to be a REAL directory**: the kernel resolves `..` after following a
//! symlink, so a symlinked `chain` would resolve back to schwung's own parent
//! and quietly share every mapping while reporting itself isolated.
//!
//! Everything except the one `.so` is symlinked. That is not a micro-optimisation
//! — `sfz` is 603 MB of soundfonts beside a 7 MB `dsp.so`, and `fopen` does not
//! care about inodes.
//!
//! This runs on the audio thread, at load, where the blocking `dlopen` it feeds
//! already hiccups (see `load_queue`). The size+mtime sidecar makes a copy
//! once-EVER per (chain, module) pair rather than once per load, which is what
//! makes that acceptable — same pattern, and same reasoning, as `chain_copy`.

use std::fs;
use std::io;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

/// Which of the chain host's three module namespaces an entry lives in, and
/// what the file it dlopens is called inside it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Synth,
    AudioFx,
    MidiFx,
}

impl Kind {
    /// The component key movy addresses a chain position by: `synth`,
    /// `fx<N>`, `midi_fx<N>`. Order matters — `midi_fx1` also starts with `fx`
    /// once the prefix is stripped, so MIDI FX must be tested first.
    pub fn from_component(component: &str) -> Option<Kind> {
        if component == "synth" {
            Some(Kind::Synth)
        } else if component.starts_with("midi_fx") {
            Some(Kind::MidiFx)
        } else if component.starts_with("fx") {
            Some(Kind::AudioFx)
        } else {
            None
        }
    }

    pub fn subdir(self) -> &'static str {
        match self {
            Kind::Synth => "sound_generators",
            Kind::AudioFx => "audio_fx",
            Kind::MidiFx => "midi_fx",
        }
    }

    /// The file the chain host dlopens inside the module directory. Audio FX are
    /// the odd one out: `<name>/<name>.so`, not `<name>/dsp.so`.
    fn so_name(self, module: &str) -> String {
        match self {
            Kind::AudioFx => format!("{}.so", module),
            _ => "dsp.so".to_string(),
        }
    }
}

const KINDS: [Kind; 3] = [Kind::Synth, Kind::AudioFx, Kind::MidiFx];

/// Per-chain private mirrors of schwung's module tree.
pub struct IsoTree {
    /// `<schwung>/.movy-iso`. Dot-prefixed and outside `modules/` so schwung's
    /// scanners — which skip `d_name[0] == '.'` — cannot mistake a mirror for an
    /// installed module.
    root: PathBuf,
    /// `<schwung>/modules`, the source of every mirrored entry.
    src_modules: PathBuf,
    /// `<schwung>/patches`.
    src_patches: PathBuf,
}

/// Freshness token for a source file: `<len>:<mtime_secs>`.
///
/// Size+mtime rather than a content hash for the same reason as `chain_copy`:
/// this is the audio thread, a stat is microseconds, and hashing 7 MB is not.
fn file_token(p: &Path) -> Option<String> {
    let md = fs::metadata(p).ok()?;
    let mtime = md.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(format!("{}:{}", md.len(), mtime))
}

/// Freshness token for a directory's membership: mtime AND entry count.
///
/// mtime alone is not enough. It has one-second granularity, so a module
/// installed in the same second as the last mirror is invisible to every movy
/// chain until something else changes the directory — and the symptom, "that
/// synth will not load on tracks 5-16", says nothing about its cause. The count
/// costs one readdir of ~41 entries on a path that is already about to block on
/// a multi-megabyte `dlopen`.
fn dir_token(p: &Path) -> Option<String> {
    let md = fs::metadata(p).ok()?;
    let mtime = md.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    let count = fs::read_dir(p).ok()?.count();
    Some(format!("d:{}:{}", mtime, count))
}

fn ioerr(what: &str, p: &Path, e: io::Error) -> String {
    format!("{} {}: {}", what, p.display(), e)
}

/// True when `p` exists as a real directory rather than a symlink to one.
/// `symlink_metadata` deliberately, since `metadata` follows the link and every
/// shared entry would answer yes.
fn is_real_dir(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.is_dir()).unwrap_or(false)
}

fn exists(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

/// Replace whatever is at `p` — symlink, file or directory — with nothing.
fn remove_any(p: &Path) -> Result<(), String> {
    match fs::symlink_metadata(p) {
        Err(_) => Ok(()),
        Ok(md) if md.is_dir() => fs::remove_dir_all(p).map_err(|e| ioerr("rm -r", p, e)),
        Ok(_) => fs::remove_file(p).map_err(|e| ioerr("rm", p, e)),
    }
}

impl IsoTree {
    /// Where the "this module cannot be isolated" marker for one module lives.
    fn unsafe_marker(&self, kind: Kind, module: &str) -> PathBuf {
        self.root.join(".unsafe").join(format!("{}-{}", kind.subdir(), module))
    }

    /// Arm the canary before handing an isolated module to the chain host.
    ///
    /// **A second independent mapping of a module is not universally safe**, and
    /// nothing off the audio thread can find that out first: `helm` takes
    /// MoveOriginal down inside `dlopen` when loaded a second time from its own
    /// copy, while the same two chains sharing one mapping are fine, and while
    /// surge (9 MB), obxd, dexed, plaits, noisemaker, forge and weird-dreams all
    /// isolate without complaint. Probing the copy cannot help, because the
    /// probe is the thing that dies.
    ///
    /// So the marker is written BEFORE the load and cleared after it returns. A
    /// module that never returns leaves its marker behind and is never isolated
    /// again — the process pays exactly one crash per module, ever, and learns
    /// something no static audit could have told it. The source's token is
    /// recorded with it so an updated module is retried rather than condemned
    /// forever.
    pub fn arm_unsafe(&self, kind: Kind, module: &str) {
        let p = self.unsafe_marker(kind, module);
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let token = self.so_token(kind, module).unwrap_or_default();
        let _ = fs::write(&p, token);
    }

    /// The load returned, so the module survived being isolated.
    pub fn disarm_unsafe(&self, kind: Kind, module: &str) {
        let _ = fs::remove_file(self.unsafe_marker(kind, module));
    }

    /// Did a previous isolated load of this module never come back?
    ///
    /// A marker whose token no longer matches the installed `.so` is stale — the
    /// user updated the module, which is exactly when it is worth trying again —
    /// so it is cleared rather than obeyed.
    pub fn is_unsafe(&self, kind: Kind, module: &str) -> bool {
        let p = self.unsafe_marker(kind, module);
        let Ok(recorded) = fs::read_to_string(&p) else { return false };
        match self.so_token(kind, module) {
            Some(now) if now == recorded.trim() => true,
            _ => {
                let _ = fs::remove_file(&p);
                false
            }
        }
    }

    fn so_token(&self, kind: Kind, module: &str) -> Option<String> {
        file_token(
            &self.src_modules.join(kind.subdir()).join(module).join(kind.so_name(module)),
        )
    }

    /// Derive the tree from schwung's chain module directory
    /// (`<schwung>/modules/chain`), which is the one path movy is already told.
    pub fn from_chain_module_dir(chain_module_dir: &str) -> Option<Self> {
        let chain = Path::new(chain_module_dir);
        let src_modules = chain.parent()?.to_path_buf();
        let schwung = src_modules.parent()?.to_path_buf();
        Some(Self {
            root: schwung.join(".movy-iso"),
            src_patches: schwung.join("patches"),
            src_modules,
        })
    }

    /// The `module_dir` to hand `create_instance` for this chain.
    pub fn module_dir(&self, chain: usize) -> String {
        self.chain_root(chain).join("modules").join("chain").to_string_lossy().into_owned()
    }

    fn chain_root(&self, chain: usize) -> PathBuf {
        self.root.join(format!("c{}", chain))
    }

    /// Build (or refresh) chain `N`'s mirror. Must succeed before `module_dir`
    /// is used, or the chain host resolves against an empty tree and the chain
    /// loads nothing at all — which is why the caller falls back to schwung's
    /// own directory on `Err` rather than proceeding with a private one.
    ///
    /// Idempotent and token-guarded: the ordinary call after the first is three
    /// `stat`s.
    pub fn prepare_chain(&self, chain: usize) -> Result<(), String> {
        let croot = self.chain_root(chain);
        let chain_dir = croot.join("modules").join("chain");
        fs::create_dir_all(&chain_dir).map_err(|e| ioerr("mkdir", &chain_dir, e))?;

        // `<module_dir>/../../patches`. A symlink is correct here: the chain host
        // only ever opendirs and fopens it.
        let patches = croot.join("patches");
        if !exists(&patches) {
            symlink(&self.src_patches, &patches).map_err(|e| ioerr("symlink", &patches, e))?;
        }

        for kind in KINDS {
            self.mirror(&croot, kind)?;
        }
        Ok(())
    }

    /// Symlink every entry of one source namespace into the chain's mirror.
    ///
    /// The whole namespace, not just the module being loaded: the chain host
    /// `opendir`s `sound_generators` to resolve pack entries
    /// (`chain_host.c:399`), so a partial mirror would break pack modules in a
    /// way nothing else here would explain.
    fn mirror(&self, croot: &Path, kind: Kind) -> Result<(), String> {
        let src = self.src_modules.join(kind.subdir());
        let dst = croot.join("modules").join(kind.subdir());
        let stamp = croot.join("modules").join(format!(".{}.src", kind.subdir()));

        let token = dir_token(&src).ok_or_else(|| format!("no {}", src.display()))?;
        if fs::read_to_string(&stamp).map(|s| s.trim() == token).unwrap_or(false) {
            return Ok(()); // membership unchanged — the common case, one stat
        }

        fs::create_dir_all(&dst).map_err(|e| ioerr("mkdir", &dst, e))?;
        for entry in fs::read_dir(&src).map_err(|e| ioerr("readdir", &src, e))? {
            let entry = entry.map_err(|e| ioerr("readdir", &src, e))?;
            let name = entry.file_name();
            let link = dst.join(&name);
            // An entry that is already there is either a symlink to the same
            // source or an isolated real copy. Neither may be clobbered: the
            // second is the private mapping this module exists to create.
            if !exists(&link) {
                symlink(entry.path(), &link).map_err(|e| ioerr("symlink", &link, e))?;
            }
        }
        let _ = fs::write(&stamp, &token); // a lost stamp costs one redundant scan
        Ok(())
    }

    /// Make chain `N`'s entry for `module` isolated (a private copy of its `.so`)
    /// or shared (a symlink to the installed one). Returns whether it ended up
    /// isolated, which is NOT always what was asked for — see below.
    ///
    /// Isolating is never undone. Going back to a symlink would buy nothing (a
    /// private copy is always safe) and would cost a directory swap under a
    /// mapping that may still be live.
    pub fn ensure(
        &self,
        chain: usize,
        kind: Kind,
        module: &str,
        isolate: bool,
    ) -> Result<bool, String> {
        if module.is_empty() {
            return Ok(false);
        }
        let croot = self.chain_root(chain);
        let dst = croot.join("modules").join(kind.subdir()).join(module);
        let src = self.src_modules.join(kind.subdir()).join(module);

        if !isolate {
            // Reverting a private copy back to a symlink is REQUIRED, not
            // tidiness: it is how a module that cannot survive being loaded
            // twice (see `unsafe`, below) stops being loaded from its copy.
            // Anything already holding the old directory keeps a valid mapping —
            // an unlinked inode stays alive while it is mapped, the same
            // property the staging swap relies on.
            if is_real_dir(&dst) {
                remove_any(&dst)?;
                let _ = fs::remove_file(croot.join("modules").join(kind.subdir())
                    .join(format!(".{}.src", module)));
            }
            if !exists(&dst) && exists(&src) {
                symlink(&src, &dst).map_err(|e| ioerr("symlink", &dst, e))?;
            }
            return Ok(false);
        }

        let so = kind.so_name(module);
        let stamp = croot
            .join("modules")
            .join(kind.subdir())
            .join(format!(".{}.src", module));
        let token = file_token(&src.join(&so))
            .ok_or_else(|| format!("no {}", src.join(&so).display()))?;
        if is_real_dir(&dst) && fs::read_to_string(&stamp).map(|s| s.trim() == token).unwrap_or(false)
        {
            return Ok(true); // already a current private copy — once ever, not once per load
        }

        // Built beside the target and swapped in, never edited in place: writing
        // over a dlopen'd `.so` corrupts its mapped pages and takes MoveOriginal
        // with it (the same rule deploy.sh follows for movy's own dsp.so). The
        // old directory's inode stays alive for anything still holding it.
        let staging = dst.with_extension("new");
        remove_any(&staging)?;
        fs::create_dir_all(&staging).map_err(|e| ioerr("mkdir", &staging, e))?;
        let mut copied = false;
        for entry in fs::read_dir(&src).map_err(|e| ioerr("readdir", &src, e))? {
            let entry = entry.map_err(|e| ioerr("readdir", &src, e))?;
            let name = entry.file_name();
            let out = staging.join(&name);
            if name.to_string_lossy() == so {
                fs::copy(entry.path(), &out).map_err(|e| ioerr("copy", &out, e))?;
                copied = true;
            } else {
                symlink(entry.path(), &out).map_err(|e| ioerr("symlink", &out, e))?;
            }
        }
        if !copied {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("{} has no {}", src.display(), so));
        }
        // Unlink first: rename(2) refuses to replace a symlink with a directory.
        remove_any(&dst)?;
        fs::rename(&staging, &dst).map_err(|e| ioerr("rename", &dst, e))?;
        let _ = fs::write(&stamp, &token);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::MetadataExt;

    /// A miniature schwung install: two sound generators, one audio FX, one
    /// MIDI FX, and a patches directory.
    fn fixture(name: &str) -> (PathBuf, IsoTree) {
        let root = std::env::temp_dir().join(format!("movy-iso-{}", name));
        let _ = fs::remove_dir_all(&root);
        let mods = root.join("modules");
        for (sub, m, so) in [
            ("sound_generators", "plaits", "dsp.so"),
            ("sound_generators", "helm", "dsp.so"),
            ("audio_fx", "belt", "belt.so"),
            ("midi_fx", "arp", "dsp.so"),
        ] {
            let d = mods.join(sub).join(m);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join(so), format!("{}-code", m)).unwrap();
            fs::write(d.join("module.json"), b"{}").unwrap();
            fs::create_dir_all(d.join("presets")).unwrap();
        }
        fs::create_dir_all(root.join("patches")).unwrap();
        fs::create_dir_all(mods.join("chain")).unwrap();
        let tree = IsoTree::from_chain_module_dir(mods.join("chain").to_str().unwrap()).unwrap();
        (root, tree)
    }

    fn ino(p: &Path) -> u64 {
        fs::metadata(p).unwrap().ino()
    }

    /// THE property. Everything else here is scaffolding around it: two chains
    /// holding one module must map two different inodes, because that is the
    /// only thing `dlopen` distinguishes.
    #[test]
    fn an_isolated_module_has_a_different_inode_from_the_shared_one() {
        let (root, t) = fixture("inode");
        let real = root.join("modules/sound_generators/plaits/dsp.so");
        t.prepare_chain(0).unwrap();
        t.prepare_chain(1).unwrap();
        assert!(!t.ensure(0, Kind::Synth, "plaits", false).unwrap());
        assert!(t.ensure(1, Kind::Synth, "plaits", true).unwrap());

        let shared = PathBuf::from(t.module_dir(0)).join("../sound_generators/plaits/dsp.so");
        let private = PathBuf::from(t.module_dir(1)).join("../sound_generators/plaits/dsp.so");
        assert_eq!(ino(&shared), ino(&real), "the incumbent keeps the installed file");
        assert_ne!(ino(&private), ino(&real), "a copy, not a link — dlopen keys on the inode");
        assert_eq!(fs::read(&private).unwrap(), b"plaits-code", "and it is the same code");
    }

    /// `..` is resolved by the kernel AFTER a symlink is followed, so mirroring
    /// `chain` as a link would send every lookup back to schwung's own tree —
    /// sharing every mapping while reporting isolation. The whole mechanism
    /// rests on this path resolving inside the mirror.
    #[test]
    fn the_chain_dir_is_real_so_dotdot_stays_inside_the_mirror() {
        let (_root, t) = fixture("dotdot");
        t.prepare_chain(3).unwrap();
        let md = PathBuf::from(t.module_dir(3));
        assert!(fs::symlink_metadata(&md).unwrap().is_dir() , "module_dir must not be a symlink");
        assert!(md.join("../sound_generators/plaits/module.json").exists());
        assert!(md.join("../../patches").exists(), "patches resolve two levels up");
        assert_eq!(
            fs::canonicalize(md.join("../sound_generators")).unwrap(),
            fs::canonicalize(t.chain_root(3).join("modules/sound_generators")).unwrap(),
            "the parent of the mirror's chain dir is the mirror, not schwung",
        );
    }

    /// Only the code is copied. sfz is 603 MB of soundfonts beside a 7 MB
    /// dsp.so; copying a module directory wholesale would be a disk and a
    /// latency problem where copying its code is neither.
    #[test]
    fn isolation_copies_only_the_so_and_symlinks_the_assets() {
        let (root, t) = fixture("assets");
        t.prepare_chain(0).unwrap();
        t.ensure(0, Kind::Synth, "plaits", true).unwrap();
        let d = t.chain_root(0).join("modules/sound_generators/plaits");
        assert!(!fs::symlink_metadata(d.join("dsp.so")).unwrap().file_type().is_symlink());
        assert!(fs::symlink_metadata(d.join("module.json")).unwrap().file_type().is_symlink());
        assert_eq!(
            ino(&d.join("module.json")),
            ino(&root.join("modules/sound_generators/plaits/module.json")),
        );
        assert!(d.join("presets").is_dir(), "asset directories come through the link");
    }

    /// Audio FX are `<name>/<name>.so`, not `<name>/dsp.so` (chain_host.c:260).
    /// Getting this wrong isolates nothing and reports success.
    #[test]
    fn each_namespace_copies_the_file_its_host_actually_dlopens() {
        let (root, t) = fixture("kinds");
        t.prepare_chain(0).unwrap();
        t.ensure(0, Kind::AudioFx, "belt", true).unwrap();
        t.ensure(0, Kind::MidiFx, "arp", true).unwrap();
        let fx = t.chain_root(0).join("modules/audio_fx/belt/belt.so");
        let mfx = t.chain_root(0).join("modules/midi_fx/arp/dsp.so");
        assert_ne!(ino(&fx), ino(&root.join("modules/audio_fx/belt/belt.so")));
        assert_ne!(ino(&mfx), ino(&root.join("modules/midi_fx/arp/dsp.so")));
    }

    #[test]
    fn components_map_to_namespaces() {
        assert_eq!(Kind::from_component("synth"), Some(Kind::Synth));
        assert_eq!(Kind::from_component("fx1"), Some(Kind::AudioFx));
        // `midi_fx1` is checked first on purpose: it also matches `fx` once
        // anyone reorders these, and would then be copied into audio_fx/.
        assert_eq!(Kind::from_component("midi_fx1"), Some(Kind::MidiFx));
        assert_eq!(Kind::from_component("mix"), None);
    }

    /// The cost argument for accepting a load-path dropout is that it is paid
    /// once EVER per (chain, module) pair. If a repeat call re-copied, it would
    /// be once per load, and the decision in the plan would not hold.
    #[test]
    fn a_current_copy_is_not_made_again() {
        let (_root, t) = fixture("cached");
        t.prepare_chain(0).unwrap();
        t.ensure(0, Kind::Synth, "plaits", true).unwrap();
        let so = t.chain_root(0).join("modules/sound_generators/plaits/dsp.so");
        let first = ino(&so);
        t.ensure(0, Kind::Synth, "plaits", true).unwrap();
        assert_eq!(ino(&so), first, "a fresh inode means the file was copied again");
    }

    /// It is a cache, not a fork: a module the user updates must reach the
    /// chains that isolated it, or movy silently runs last month's build.
    #[test]
    fn a_changed_source_refreshes_the_copy() {
        let (root, t) = fixture("refresh");
        t.prepare_chain(0).unwrap();
        t.ensure(0, Kind::Synth, "plaits", true).unwrap();
        let src = root.join("modules/sound_generators/plaits/dsp.so");
        fs::write(&src, b"plaits-code-v2-longer").unwrap();
        t.ensure(0, Kind::Synth, "plaits", true).unwrap();
        let so = t.chain_root(0).join("modules/sound_generators/plaits/dsp.so");
        assert_eq!(fs::read(&so).unwrap(), b"plaits-code-v2-longer");
    }

    /// Installing a module after a mirror was built must not leave it invisible
    /// to every movy chain — the failure would look like "that synth does not
    /// load on tracks 5-16", which is nothing like its cause.
    #[test]
    fn a_newly_installed_module_appears_in_an_existing_mirror() {
        let (root, t) = fixture("install");
        t.prepare_chain(0).unwrap();
        let newmod = root.join("modules/sound_generators/dexed");
        fs::create_dir_all(&newmod).unwrap();
        fs::write(newmod.join("dsp.so"), b"dexed-code").unwrap();
        t.prepare_chain(0).unwrap();
        assert!(t.chain_root(0).join("modules/sound_generators/dexed/dsp.so").exists());
    }

    /// Re-mirroring walks the whole namespace and must not undo an isolation on
    /// its way through — that would silently re-share a mapping the planner has
    /// already stopped pinning.
    #[test]
    fn re_mirroring_does_not_clobber_an_isolated_entry() {
        let (root, t) = fixture("clobber");
        t.prepare_chain(0).unwrap();
        t.ensure(0, Kind::Synth, "plaits", true).unwrap();
        let so = t.chain_root(0).join("modules/sound_generators/plaits/dsp.so");
        let before = ino(&so);
        // Force a re-mirror by changing the source directory's membership.
        fs::create_dir_all(root.join("modules/sound_generators/dexed")).unwrap();
        t.prepare_chain(0).unwrap();
        assert!(is_real_dir(&t.chain_root(0).join("modules/sound_generators/plaits")));
        assert_eq!(ino(&so), before);
    }

    /// A pack entry is resolved by opendir'ing the whole namespace
    /// (chain_host.c:399), so mirroring only the module being loaded would
    /// break pack modules and nothing else.
    #[test]
    fn the_whole_namespace_is_mirrored_not_just_what_is_loaded() {
        let (_root, t) = fixture("whole");
        t.prepare_chain(0).unwrap();
        let sg = t.chain_root(0).join("modules/sound_generators");
        assert!(sg.join("helm").exists() && sg.join("plaits").exists());
    }

    /// A module that cannot survive a second mapping has to stop being loaded
    /// from its copy, which means the directory must go back to being a symlink.
    /// Leaving the copy in place would crash the host on every load forever.
    #[test]
    fn isolation_is_reverted_when_it_is_not_wanted() {
        let (root, t) = fixture("revert");
        t.prepare_chain(0).unwrap();
        assert!(t.ensure(0, Kind::Synth, "plaits", true).unwrap());
        assert!(!t.ensure(0, Kind::Synth, "plaits", false).unwrap());
        let e = t.chain_root(0).join("modules/sound_generators/plaits");
        assert!(fs::symlink_metadata(&e).unwrap().file_type().is_symlink());
        assert_eq!(ino(&e.join("dsp.so")),
            ino(&root.join("modules/sound_generators/plaits/dsp.so")),
            "back to the installed inode — the whole point of reverting");
    }

    /// The canary. `helm` takes MoveOriginal down inside the second `dlopen`,
    /// and nothing that runs first can discover that — so the fact is recorded
    /// by a marker that only a returning load erases.
    #[test]
    fn a_load_that_never_returns_leaves_the_module_marked_unsafe() {
        let (_root, t) = fixture("canary");
        t.prepare_chain(0).unwrap();
        assert!(!t.is_unsafe(Kind::Synth, "helm"));
        t.arm_unsafe(Kind::Synth, "helm");
        // No disarm: this is the process dying inside the load.
        assert!(t.is_unsafe(Kind::Synth, "helm"));
    }

    #[test]
    fn a_load_that_returns_clears_the_marker() {
        let (_root, t) = fixture("disarm");
        t.prepare_chain(0).unwrap();
        t.arm_unsafe(Kind::Synth, "plaits");
        t.disarm_unsafe(Kind::Synth, "plaits");
        assert!(!t.is_unsafe(Kind::Synth, "plaits"));
    }

    /// Condemning a module forever would make one bad version permanent. The
    /// marker is tied to the `.so` it was recorded against, so an update retries.
    #[test]
    fn updating_the_module_retries_isolation() {
        let (root, t) = fixture("retry");
        t.prepare_chain(0).unwrap();
        t.arm_unsafe(Kind::Synth, "helm");
        assert!(t.is_unsafe(Kind::Synth, "helm"));
        fs::write(root.join("modules/sound_generators/helm/dsp.so"), b"helm-code-v2").unwrap();
        assert!(!t.is_unsafe(Kind::Synth, "helm"), "a new build deserves a fresh attempt");
    }

    #[test]
    fn a_missing_module_is_an_error_not_a_panic() {
        let (_root, t) = fixture("missing");
        t.prepare_chain(0).unwrap();
        assert!(t.ensure(0, Kind::Synth, "nosuch", true).is_err());
        assert!(!t.ensure(0, Kind::Synth, "nosuch", false).unwrap());
        assert!(!t.ensure(0, Kind::Synth, "", true).unwrap());
    }

    #[test]
    fn no_staging_directory_is_left_behind() {
        let (_root, t) = fixture("staging");
        t.prepare_chain(0).unwrap();
        t.ensure(0, Kind::Synth, "plaits", true).unwrap();
        assert!(!t.chain_root(0).join("modules/sound_generators/plaits.new").exists());
    }

    /// The mirror lives outside `modules/` and is dot-prefixed, so schwung's
    /// scanners cannot list movy's twelve copies of plaits as installed modules.
    #[test]
    fn the_mirror_is_hidden_and_outside_the_module_tree() {
        let (root, t) = fixture("hidden");
        t.prepare_chain(0).unwrap();
        assert_eq!(t.root, root.join(".movy-iso"));
        assert!(!t.root.starts_with(root.join("modules")));
    }
}
