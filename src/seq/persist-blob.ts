/* On-disk envelope around the engine's own state serialization.
 *
 * host_write_file is fopen("w") + fwrite + fclose — no temp-and-rename, no
 * fsync — so a crash or power-cut mid-write leaves a truncated file. The
 * engine's loader accepts any blob whose first line is "movy1" and skips lines
 * it doesn't recognise, which means a torn file used to load as a silently
 * *partial* set: some tracks present, the rest gone, no error anywhere.
 *
 *   movy1                       <- unchanged, so old builds still load us
 *   gen 42                      <- generation, at the TOP so truncation keeps it
 *   …engine payload…
 *   end 42 1850 2a1f3c04        <- generation, payload length, adler32
 *
 * `gen` and `end` are unknown verbs to seq-core's persist::load, which ignores
 * them, so the file stays loadable by every older movy build. A blob carrying
 * `gen` but no matching trailer is a torn write and is rejected; a blob with
 * neither line is a legacy file and is accepted as generation 0. Splitting the
 * marker (top) from the checksum (bottom) is what makes those two cases
 * distinguishable — without it a truncation deep in the payload is
 * indistinguishable from a pre-envelope file. */

const TAG = 'movy1';

/* Adler-32: short, dependency-free, and enough to catch the zero-filled tails
 * and short writes that a torn save actually produces. The payload is ASCII
 * (integers plus param keys), so charCodeAt doubles as the byte value. */
export function adler32(s: string): number {
    let a = 1, b = 0;
    for (let i = 0; i < s.length; i++) {
        a = (a + (s.charCodeAt(i) & 0xff)) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

export interface ParsedState {
    payload: string;   // exactly what the engine serialized / will be fed
    gen: number;       // envelope generation; higher wins when copies disagree
}

/** Envelope `payload` for generation `gen`. */
export function wrapState(payload: string, gen: number): string {
    const p = payload.endsWith('\n') ? payload : payload + '\n';
    const rest = p.slice(p.indexOf('\n') + 1);
    return TAG + '\ngen ' + gen + '\n' + rest
        + 'end ' + gen + ' ' + p.length + ' ' + adler32(p) + '\n';
}

/** Read an envelope back. `null` = unusable: wrong tag, or a torn write. */
export function parseState(raw: string | null): ParsedState | null {
    if (!raw) return null;
    const lines = raw.split('\n');
    if ((lines[0] || '').trim() !== TAG) return null;

    // No generation marker → written before the envelope existed. Trust it:
    // that is the only shape every currently-installed build produces.
    if (!(lines[1] || '').startsWith('gen ')) return { payload: raw, gen: 0 };

    const gen = Number(lines[1].slice(4).trim());
    if (!isFinite(gen)) return null;

    let last = lines.length - 1;
    while (last > 0 && lines[last] === '') last--;
    const tr = lines[last].split(' ');
    if (tr[0] !== 'end' || tr.length !== 4 || Number(tr[1]) !== gen) return null;

    const payload = TAG + '\n' + lines.slice(2, last).join('\n') + (last > 2 ? '\n' : '');
    if (payload.length !== Number(tr[2]) || adler32(payload) !== Number(tr[3])) return null;
    return { payload, gen };
}
