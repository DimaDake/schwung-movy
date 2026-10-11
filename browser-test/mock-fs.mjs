/* In-memory stand-in for the device's host_* file API. Persistence tests need
 * to crash, truncate and fail writes on demand — none of which a real device
 * will do to order — so the whole filesystem is a plain object here. */

/* Marker value for a path that exists as a directory rather than a file:
 * host_file_exists stats, so a directory answers true, but reading it back
 * must not look like content. */
export const DIR = null;

/* The FS globals this install replaces — the harness's own, which `env.mjs`
 * installs once (`host_read_file` there is `serveModuleLayout`).
 *
 * Captured by the OUTERMOST install only, and cleared when an uninstall gives
 * them back. Suites genuinely nest installs (`set-session.mjs` has four
 * outstanding at once), and a capture per install would make the innermost mock
 * — not the harness's — what the last uninstall restores. `had` keeps "there
 * was none" distinguishable from "there was one that answered undefined". */
const FS_GLOBALS = ['host_read_file', 'host_write_file', 'host_file_exists', 'host_ensure_dir', 'host_remove_dir'];
let saved = null;

export function installMockFs(seed = {}) {
    saved ??= Object.fromEntries(FS_GLOBALS.map((k) => [k, { had: k in globalThis, value: globalThis[k] }]));
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
    /* Restored, not deleted. Every FS global is called without a typeof gate,
     * so deleting one left every later suite to throw; and `host_read_file`'s
     * one installer, `env.mjs`'s `serveModuleLayout`, is what serves a module
     * its shipped layout. */
    if (!saved) return;
    for (const k of FS_GLOBALS) {
        if (saved[k].had) globalThis[k] = saved[k].value;
        else delete globalThis[k];
    }
    saved = null;
}
