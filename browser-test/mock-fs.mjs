/* In-memory stand-in for the device's host_* file API. Persistence tests need
 * to crash, truncate and fail writes on demand — none of which a real device
 * will do to order — so the whole filesystem is a plain object here. */

export function installMockFs(seed = {}) {
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
    globalThis.host_ensure_dir = () => true;
    return fs;
}

export function uninstallMockFs() {
    delete globalThis.host_write_file;
    delete globalThis.host_file_exists;
    delete globalThis.host_ensure_dir;
    globalThis.host_read_file = () => null;   // logic.mjs's default stub
}
