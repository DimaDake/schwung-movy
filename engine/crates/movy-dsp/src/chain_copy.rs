//! Keeping movy's private copy of schwung's `chain/dsp.so` in step with the
//! installed one.
//!
//! movy dlopens a COPY so it gets its own mapping and its own `g_host`
//! (see chain_host.rs). A copy can drift from its source, so this makes it a
//! **cache, not a fork**: the source's size and mtime are recorded in a sidecar
//! next to the copy, and the copy is refreshed whenever they differ. movy
//! therefore always hosts whatever chain-host version the user has installed,
//! and there is no version to maintain (design §6.1).
//!
//! Size+mtime rather than a content hash on purpose: this runs on the audio
//! thread (like every other load-path operation — see load_queue), and a stat
//! is microseconds where hashing 200 KB is milliseconds. The failure mode of
//! stat-comparison is a missed update when a rebuild produces an identical size
//! AND identical mtime, which a real install cannot do.

use std::fs;
use std::path::Path;

/// Freshness token for the source `.so`: `<len>:<mtime_secs>`.
fn source_token(src: &Path) -> Option<String> {
    let md = fs::metadata(src).ok()?;
    let mtime = md
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some(format!("{}:{}", md.len(), mtime))
}

/// Ensure `dst` is a current copy of `src`. Returns true when `dst` is usable.
///
/// **Never writes over the file in place.** Overwriting a dlopen'd `.so`
/// corrupts its mapped pages and crashes MoveOriginal — the same rule
/// `deploy.sh` follows for movy's own dsp.so. The copy is written to a temp path
/// and renamed, giving a fresh inode; anything already holding the old one keeps
/// a valid mapping.
pub fn ensure_copy(src: &str, dst: &str) -> Result<bool, String> {
    let src_path = Path::new(src);
    let dst_path = Path::new(dst);

    let token = source_token(src_path)
        .ok_or_else(|| format!("chain host source not found: {}", src))?;
    let stamp_path = format!("{}.src", dst);

    if dst_path.exists() {
        if let Ok(existing) = fs::read_to_string(&stamp_path) {
            if existing.trim() == token {
                return Ok(true); // already current — the common case
            }
        }
    }

    if let Some(parent) = dst_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {:?}: {}", parent, e))?;
    }

    let tmp = format!("{}.tmp", dst);
    fs::copy(src_path, &tmp).map_err(|e| format!("copy {} -> {}: {}", src, tmp, e))?;
    fs::rename(&tmp, dst_path).map_err(|e| format!("rename {} -> {}: {}", tmp, dst, e))?;
    // Best-effort: a missing stamp only costs one redundant copy next time.
    let _ = fs::write(&stamp_path, &token);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmpdir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("movy-chain-copy-{}", name));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(p: &Path, bytes: &[u8]) {
        let mut f = fs::File::create(p).unwrap();
        f.write_all(bytes).unwrap();
    }

    #[test]
    fn copies_when_absent() {
        let d = tmpdir("absent");
        let src = d.join("dsp.so");
        let dst = d.join("private/dsp.so");
        write(&src, b"chain-host-v1");

        assert!(ensure_copy(src.to_str().unwrap(), dst.to_str().unwrap()).unwrap());
        assert_eq!(fs::read(&dst).unwrap(), b"chain-host-v1");
    }

    #[test]
    fn refreshes_when_the_source_changes() {
        let d = tmpdir("refresh");
        let src = d.join("dsp.so");
        let dst = d.join("private/dsp.so");
        write(&src, b"chain-host-v1");
        ensure_copy(src.to_str().unwrap(), dst.to_str().unwrap()).unwrap();

        // A schwung update: different content, different length.
        write(&src, b"chain-host-v2-longer");
        ensure_copy(src.to_str().unwrap(), dst.to_str().unwrap()).unwrap();
        assert_eq!(fs::read(&dst).unwrap(), b"chain-host-v2-longer",
            "the copy tracks the install — it is a cache, not a fork");
    }

    #[test]
    fn leaves_a_current_copy_alone() {
        let d = tmpdir("current");
        let src = d.join("dsp.so");
        let dst = d.join("private/dsp.so");
        write(&src, b"chain-host-v1");
        ensure_copy(src.to_str().unwrap(), dst.to_str().unwrap()).unwrap();

        // Marker proves the file was not rewritten: rewriting a dlopen'd .so in
        // place is what corrupts its mapping and crashes the host.
        let inode_marker = d.join("private/dsp.so.marker");
        write(&inode_marker, b"x");
        ensure_copy(src.to_str().unwrap(), dst.to_str().unwrap()).unwrap();
        assert!(inode_marker.exists());
        assert_eq!(fs::read(&dst).unwrap(), b"chain-host-v1");
    }

    #[test]
    fn missing_source_is_an_error_not_a_panic() {
        let d = tmpdir("missing");
        let r = ensure_copy(
            d.join("nope.so").to_str().unwrap(),
            d.join("private/dsp.so").to_str().unwrap(),
        );
        assert!(r.is_err(), "a missing chain host degrades, it does not crash");
    }

    #[test]
    fn no_temp_file_is_left_behind() {
        let d = tmpdir("tmp");
        let src = d.join("dsp.so");
        let dst = d.join("private/dsp.so");
        write(&src, b"chain-host-v1");
        ensure_copy(src.to_str().unwrap(), dst.to_str().unwrap()).unwrap();
        assert!(!d.join("private/dsp.so.tmp").exists(), "the temp copy is renamed, not orphaned");
    }
}
