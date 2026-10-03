/* schwung-page-prefetch.ts — every pad's page, read before the pad is pressed
 * (plan 2026-09-30, D12).
 *
 * A pad switch turns the drum page to keys the cache has never been asked for:
 * a sibling rack's next voice page, or a template rack's same page re-keyed to
 * `pad9_*`. SP-39's warm made that one bulk read instead of eight, but it was
 * still a blocking round trip ON THE PRESS. D12 wants none, so the keys every
 * pad would show are read in the background and the press is served from here.
 *
 * NO ROUND TRIP OF ITS OWN. The epoch fill already sends one bulk request every
 * FILL_TICKS, sized for a page (9-16 keys) against a 48-key cap; the spare room
 * carries the next slice of this set, round-robin. simian's 16 pads x 3 levels
 * is ~380 keys, covered in ~13 fills.
 *
 * AGE-BOUNDED. A value here moves only by a write movy makes (the cache's write
 * log drops it) or by the module itself (an automation lane, a kit load). One
 * older than MAX_AGE_EPOCHS is not served, so a set too large to cycle in that
 * time (dr32's 32 pads x 48 pages) degrades to the live read it had before,
 * never to an arbitrarily stale knob.
 */

export const MAX_AGE_EPOCHS = 48;

export interface Prefetch {
    /** Replace the set. A no-op for the same array. */
    want(keys: readonly string[]): void;
    /** The next keys to ride a fill, up to `room`, skipping `skip`. */
    take(room: number, skip: ReadonlySet<string>): string[];
    store(key: string, value: string, epoch: number): void;
    /** A value read within MAX_AGE_EPOCHS of `epoch`, or undefined. */
    get(key: string, epoch: number): string | undefined;
    drop(key: string): void;
    clear(): void;
}

export function createPrefetch(): Prefetch {
    let keys: readonly string[] = [];
    let cursor = 0;
    const got = new Map<string, { value: string; epoch: number }>();
    return {
        want(k) {
            if (k === keys) return;
            keys = k; cursor = 0;
            const keep = new Set(k);
            for (const key of [...got.keys()]) if (!keep.has(key)) got.delete(key);
        },
        take(room, skip) {
            const out: string[] = [];
            for (let n = 0; n < keys.length && out.length < room; n++) {
                const k = keys[cursor];
                cursor = (cursor + 1) % keys.length;
                if (!skip.has(k)) out.push(k);
            }
            return out;
        },
        store(key, value, epoch) { got.set(key, { value, epoch }); },
        get(key, epoch) {
            const e = got.get(key);
            return e && epoch - e.epoch <= MAX_AGE_EPOCHS ? e.value : undefined;
        },
        drop(key) { got.delete(key); },
        clear() { got.clear(); },
    };
}
