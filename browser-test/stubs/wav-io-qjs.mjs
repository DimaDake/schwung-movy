/* Browser-build stand-in for Schwung's wav_io_qjs.mjs (SP-42).
 *
 * The real file statically imports QuickJS's built-in `std`/`os` modules,
 * which do not exist under esbuild/node — build/browser.mjs redirects the
 * `param_pages/wav_io_qjs.mjs` specifier here instead of skipping it, so the
 * registration this file exists to perform still happens in local tests.
 *
 * Backed by the SAME globalThis.std/os mocks browser-test/env.mjs already
 * installs for movy's own src/model/wav-peaks.ts suite (env.setFiles) —
 * reusing them rather than inventing a second IO-backing mechanism.
 *
 * setWavPeaksIO is imported from the absolute schwung path so the resolver
 * plugin's generic rule points it at the real, un-stubbed wav_peaks.mjs — the
 * SAME module instance schwung-lib.ts's own import resolves to, which is what
 * makes this registration visible there.
 */
import { setWavPeaksIO } from '/data/UserData/schwung/shared/param_pages/wav_peaks.mjs';

setWavPeaksIO({
    open(path) {
        const f = globalThis.std.open(path, 'rb');
        if (!f) return null;
        return {
            read: (buf, pos, len) => f.read(buf, pos, len),
            seek: (off, whence) => f.seek(off, whence),
            close: () => f.close(),
        };
    },
    stat(path) {
        const st = globalThis.os.stat(path);
        if (!st || st[1] !== 0 || !st[0]) return null;
        return { size: st[0].size || 0, mtime: st[0].mtime || 0 };
    },
});
