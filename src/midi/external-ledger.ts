/* Which track each held USB-A key is recording into. Kept apart from the pad
 * ledger (keyboard/held-notes.ts) on purpose: that one also releases what it
 * holds on an octave or root change, and an external key sounds from the engine,
 * which closes it from its own ledger (ext_route.rs) when the key comes up. */

/* Keys live above the pad range (68..99) so a recording entry keyed by them in
 * router-pads/step-rec can never collide with a pad's. */
export const EXT_KEY_BASE = 1000;

const held = new Map<number, number>();   /* key → track */

export function extHold(key: number, track: number): void { held.set(key, track); }

export function extRelease(key: number): number | undefined {
    const t = held.get(key);
    held.delete(key);
    return t;
}

export function extHeldTrack(key: number): number | undefined { return held.get(key); }
