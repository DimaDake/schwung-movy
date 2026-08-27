/* Per-set state context. Schwung stores tracks per native Move set; movy
 * mirrors that by keying its state files on the active set's UUID. The active
 * set is identified by /data/UserData/schwung/active_set.txt (line 1 = UUID,
 * line 2 = name) — the same source davebox's seq8 tool reads. */

const SETS_DIR      = '/data/UserData/schwung/modules/tools/movy/sets';
const NAME_INDEX    = SETS_DIR + '/name-index.json';
const ACTIVE_SET    = '/data/UserData/schwung/active_set.txt';
/* Move stores each set's folder under its UUID; used to skip deleted sets. */
export const MOVE_SETS_DIR = '/data/UserData/UserLibrary/Sets';

/* Loading this blank (tag-only) blob makes the engine clear all clips/tracks:
 * seq-core persist::load() resets everything before applying, and a payload
 * with only the FORMAT_TAG ("movy1") applies nothing → clean slate. */
export const BLANK_STATE = 'movy1\n';

function readFile(path: string): string | null {
    return (typeof host_read_file === 'function') ? host_read_file(path) : null;
}
function writeFile(path: string, content: string): void {
    if (typeof host_write_file === 'function') host_write_file(path, content);
}
export function fileExists(path: string): boolean {
    if (typeof host_file_exists === 'function') return host_file_exists(path);
    const d = readFile(path);            // fallback: non-empty read == exists
    return d !== null && d.length > 0;
}
/* Per-set writes go under sets/<uuid>/, which host_write_file will NOT create
 * on the device — ensure the directory first (davebox does the same). The
 * `_default` fallback has to be spelled the same way the path helpers spell it,
 * or the directory made here is not the one written into. */
export function ensureDir(uuid: string): void {
    if (typeof host_ensure_dir === 'function')
        host_ensure_dir(SETS_DIR + '/' + (uuid || '_default'));
}

export function uuidToStatePath(uuid: string): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/seq-state.json';
}
export function uuidToUiStatePath(uuid: string): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/ui-state.json';
}
/* Rotating shadow copies of the state file. The canonical seq-state.json is
 * what older builds read; these two exist only so a torn canonical write never
 * costs more than the generation being written. */
export function shadowPath(uuid: string, slot: number): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/seq-state.' + slot + '.json';
}

/* Provisional: an id that names a pad Move has not committed to disk rather
 * than a Set. `_default` (no answer at all) counts — it is not a Set either.
 *
 * schwung mints a fresh `__pending-<index>-<seq>` on every visit to such a pad
 * and movy follows it verbatim, exactly as davebox's seq8 does: it is the id
 * both hosts agree on. What that costs, and what fixing it would take, is
 * `docs/pending-sets.md`. */
export function isProvisionalUuid(uuid: string): boolean {
    return uuid === '' || uuid === '_default' || uuid.startsWith('__');
}

/* Everything movy holds for one Set lives under a single directory, so one
 * removal clears all of it — state, shadows and UI blob. `host_remove_dir` is
 * registered for module JS and permits any path under `modules/`, which is
 * where this tree lives (schwung js_host_common.c). */
export function removeSetState(uuid: string): boolean {
    if (!uuid || typeof host_remove_dir !== 'function') return false;
    return host_remove_dir(SETS_DIR + '/' + uuid);
}

export interface SetId { uuid: string; name: string; }

/* The active set (line 1 = UUID, line 2 = name), or `null` when we genuinely
 * don't know which set is active: active_set.txt missing, unreadable, or
 * naming one of Move's transient placeholder ids (a set being created shows up
 * as `__pending-0-1` for a moment — a device in the wild grew a whole
 * sets/__pending-0-1/ directory that way).
 *
 * Callers must treat null as "keep the set we already have" and never as a set
 * of its own. The old reader collapsed all three cases to {uuid:''}, which
 * pointed every autosave at the `_default` set and then threw that work away
 * when the real uuid reappeared and its older file was reloaded. */
export function readActiveSet(): SetId | null {
    const raw = readFile(ACTIVE_SET);
    if (!raw) return null;
    const lines = raw.split('\n');
    const uuid = (lines[0] || '').trim();
    if (!uuid || uuid.startsWith('__')) return null;
    return { uuid, name: (lines[1] || '').trim() };
}

/* The active set INCLUDING a placeholder id, and whether it is one.
 *
 * `readActiveSet` reports a placeholder as "we don't know", which is right for
 * anything that must not treat it as a set of its own. The set session wants
 * the opposite: schwung works under `__pending-<index>-<seq>` for a measured
 * 12-60 s while Move materialises the real Set, and movy adopts that same id so
 * both sides make the same transition at the same moment. */
export function readActiveSetAny(): { id: SetId; provisional: boolean } | null {
    const raw = readFile(ACTIVE_SET);
    if (!raw) return null;
    const lines = raw.split('\n');
    const uuid = (lines[0] || '').trim();
    if (!uuid) return null;
    return {
        id: { uuid, name: (lines[1] || '').trim() },
        provisional: isProvisionalUuid(uuid),
    };
}

export function loadNameIndex(): Record<string, string> {
    const raw = readFile(NAME_INDEX);
    if (!raw) return {};
    try {
        const o = JSON.parse(raw);
        return (o && typeof o === 'object') ? o : {};
    } catch { return {}; }
}
export function saveNameIndex(idx: Record<string, string>): void {
    writeFile(NAME_INDEX, JSON.stringify(idx));
}
export function rememberSet(name: string, uuid: string): void {
    if (!name || !uuid) return;
    const idx = loadNameIndex();
    if (idx[name] === uuid) return;
    idx[name] = uuid;
    saveNameIndex(idx);
}
