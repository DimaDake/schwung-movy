/* In-memory stand-in for the device's host_* file API. Persistence tests need
 * to crash, truncate and fail writes on demand — none of which a real device
 * will do to order — so the whole filesystem is a plain object here. */

/* Marker value for a path that exists as a directory rather than a file:
 * host_file_exists stats, so a directory answers true, but reading it back
 * must not look like content. */
export const DIR = null;

/* The reader this install replaces — the harness's own `host_read_file`, which
 * `env.mjs` installs exactly once as `(path) => serveModuleLayout(path)`.
 *
 * Captured by the OUTERMOST install only, and cleared when an uninstall gives
 * it back. Suites genuinely nest installs (`set-session.mjs` has four
 * outstanding at once), and a capture per install would make the innermost mock
 * — not the harness's reader — what the last uninstall restores, which is the
 * same loss of the real reader this restore exists to prevent, one layer in.
 * `had` keeps "there was no reader" distinguishable from "there was one that
 * answered undefined", because the restore DELETES in the first case: a global
 * left holding `undefined` throws a TypeError on the next call rather than
 * failing the read. */
let savedReadFile = null;

export function installMockFs(seed = {}) {
    savedReadFile ??= { had: 'host_read_file' in globalThis, value: globalThis.host_read_file };
    const files = { ...seed };
    const fs = {
        files,
        /* path substring whose writes should fail, or true for every write */
        failWrites: null,
        /* { path: substring, at: n } — write only the first n chars, and still
         * report success: this is exactly what a power-cut mid-fwrite looks
         * like from JS. */
        truncate: null,
        writes: [],
        removed: [],
    };
    globalThis.host_read_file = (p) => (p in files ? files[p] : null);
    globalThis.host_write_file = (p, c) => {
        fs.writes.push(p);
        if (fs.failWrites === true || (fs.failWrites && p.includes(fs.failWrites))) return false;
        if (fs.truncate && p.includes(fs.truncate.path)) {
            files[p] = c.slice(0, fs.truncate.at);
            return true;
        }
        files[p] = c;
        return true;
    };
    globalThis.host_file_exists = (p) => p in files;
    globalThis.host_ensure_dir = (p) => { files[p] = files[p] ?? DIR; return true; };
    /* rm -rf: the real one takes a directory and everything under it. */
    globalThis.host_remove_dir = (p) => {
        fs.removed.push(p);
        for (const k of Object.keys(files))
            if (k === p || k.startsWith(p + '/')) delete files[k];
        return true;
    };
    return fs;
}

export function uninstallMockFs() {
    delete globalThis.host_remove_dir;
    delete globalThis.host_write_file;
    delete globalThis.host_file_exists;
    delete globalThis.host_ensure_dir;
    /* Restored, not downgraded. This used to assign `() => null` with the
     * comment "logic.mjs's default stub" — a reader that does not exist.
     * `host_read_file` has exactly one installer, `env.mjs`'s
     * `serveModuleLayout`, and it is what serves a module its shipped layout;
     * overwriting it here took that away from every suite afterwards and
     * nothing put it back. Latent while a later `createDumpBoot()` happened to
     * reassign the global anyway; the dump boot now restores instead of
     * leaking, so this pair is the only thing holding the reader's identity. */
    if (savedReadFile) {
        if (savedReadFile.had) globalThis.host_read_file = savedReadFile.value;
        else delete globalThis.host_read_file;
        savedReadFile = null;
    }
}
