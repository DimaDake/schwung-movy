/* Wire format for schwung's bulk param channel.
 *
 * `shadow_get_params` / `shadow_set_params` (shadow_ui.c, request types 3 and 4)
 * collapse N param round trips into one, and route straight to the overtake DSP
 * — which is movy's own engine. That is what makes a movy-hosted chain's params
 * affordable: one blocking IPC for a whole page of knobs instead of eight.
 *
 * Payload, both directions (schwung_shim.c:3440 bulk_next / bulk_put):
 *
 *     <count>\n  then <count> items, each  <byte-length>\n<bytes>
 *
 * GET sends keys and receives values in the same order. SET sends key and value
 * interleaved, so its count is twice the number of pairs. Lengths are BYTE
 * counts, which is why this file measures encoded bytes rather than string
 * length — a multi-byte character in a preset name would otherwise truncate the
 * payload and desynchronise every item after it. */

/* QuickJS on the device has TextEncoder; the browser tests run on node, which
 * also does. Fall back to a manual UTF-8 length only if it is missing. */
function byteLen(s: string): number {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }  // surrogate pair
        else n += 3;
    }
    return n;
}

export function encodeBulk(items: string[]): string {
    let out = items.length + '\n';
    for (const it of items) out += byteLen(it) + '\n' + it;
    return out;
}

/* A count/length field. Rejects the empty string explicitly: Number('') is 0,
 * so a MISSING length would otherwise decode as a zero-length item and every
 * item after it would be read from the wrong offset. */
function parseCount(s: string): number | null {
    if (s.length === 0 || !/^[0-9]+$/.test(s)) return null;
    const n = Number(s);
    return Number.isInteger(n) ? n : null;
}

/* Decode a bulk response into its items. Returns null when the payload is
 * malformed — a caller must not silently treat a truncated response as a set of
 * empty values, because that reads as "every param is 0". */
export function decodeBulk(payload: string | null): string[] | null {
    if (payload === null) return null;
    let i = payload.indexOf('\n');
    if (i < 0) return null;
    const count = parseCount(payload.slice(0, i));
    if (count === null) return null;
    i++;

    const out: string[] = [];
    for (let n = 0; n < count; n++) {
        const nl = payload.indexOf('\n', i);
        if (nl < 0) return null;
        const len = parseCount(payload.slice(i, nl));
        if (len === null) return null;
        i = nl + 1;
        /* Lengths are bytes but this is a JS string. They agree for ASCII, which
         * is what param keys and numeric values are; a multi-byte value would
         * over-slice, so it is clamped to what is actually there rather than
         * returning garbage from beyond the end. */
        const end = Math.min(i + len, payload.length);
        out.push(payload.slice(i, end));
        i = end;
    }
    return out;
}
