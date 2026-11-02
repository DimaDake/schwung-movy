/* Parked generator sessions (preview.ts): one per clip, kept while the user
 * works elsewhere and taken back up on returning to that clip. RAM only — a
 * Set change, an undo or a restart ends them all. */

const parked = new Map<string, unknown>();

export const clipKey = (track: number, slot: number): string => track + ':' + slot;

export function parkSession<T>(key: string, o: T): void { parked.set(key, o); }

/** The session parked on `key`, removed from the parked set. */
export function takeSession<T>(key: string): T | undefined {
    const o = parked.get(key) as T | undefined;
    parked.delete(key);
    return o;
}

export function hasParked(): boolean { return parked.size > 0; }

/** Every parked session's clip, and none parked afterwards. */
export function clearParked(): string[] {
    const keys = [...parked.keys()];
    parked.clear();
    return keys;
}

/* The latest session kept on each clip (preview-undo.ts): an undo of its
 * entry reopens it; a newer run on the clip, a deleted clip or a Set change
 * forgets it. */
const latest = new Map<string, unknown>();
export function keepLatest<T>(key: string, o: T): void { latest.set(key, o); }
export function latestOn<T>(key: string): T | undefined { return latest.get(key) as T | undefined; }
export function forgetLatest(key?: string): void { if (key === undefined) latest.clear(); else latest.delete(key); }
