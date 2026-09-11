/* Did this Set's state actually reach the engine?
 *
 * Its own module so `set-load` (which knows the answer) and `set-save` (which
 * must not act without it) can share it without importing each other.
 *
 * The rule it exists to enforce: a Set on disk is worth more than whatever a
 * blank engine is holding. If the restore never landed, saving would replace
 * real music with nothing — at a HIGHER generation, so the blank would win
 * every later restore too.
 *
 * Defaults to TRUE. An unknown answer must not block saving: a Set that never
 * had a restore to lose is exactly the case where refusing to save would be
 * the destructive choice. Only a restore we KNOW failed closes the gate.
 */
let landed = true;

export function noteRestore(ok: boolean): void { landed = ok; }
export function restoreLanded(): boolean { return landed; }
export function resetRestoreGate(): void { landed = true; }
