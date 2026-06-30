/* Per-set state context. Schwung stores tracks per native Move set; movy
 * mirrors that by keying its state files on the active set's UUID. The active
 * set is identified by /data/UserData/schwung/active_set.txt (line 1 = UUID,
 * line 2 = name) — the same source davebox's seq8 tool reads. */

const SETS_DIR      = '/data/UserData/schwung/modules/tools/movy/sets';
const NAME_INDEX    = SETS_DIR + '/name-index.json';
const ACTIVE_SET    = '/data/UserData/schwung/active_set.txt';
/* Move stores each set's folder under its UUID; used to skip deleted sets. */
const MOVE_SETS_DIR = '/data/UserData/UserLibrary/Sets';

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
function fileExists(path: string): boolean {
    if (typeof host_file_exists === 'function') return host_file_exists(path);
    const d = readFile(path);            // fallback: non-empty read == exists
    return d !== null && d.length > 0;
}
function ensureDir(uuid: string): void {
    if (typeof host_ensure_dir === 'function') host_ensure_dir(SETS_DIR + '/' + uuid);
}

export function uuidToStatePath(uuid: string): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/seq-state.json';
}
export function uuidToUiStatePath(uuid: string): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/ui-state.json';
}

/* line 1 = UUID, line 2 = name; {uuid:'',name:''} if missing/unreadable. */
export function readActiveSet(): { uuid: string; name: string } {
    const raw = readFile(ACTIVE_SET);
    if (!raw) return { uuid: '', name: '' };
    const lines = raw.split('\n');
    return { uuid: (lines[0] || '').trim(), name: (lines[1] || '').trim() };
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

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Move's Copy/Paste appends " Copy" then " Copy N"; strip one level. */
export function stripCopySuffix(name: string): string | null {
    const m = (name || '').match(/^(.*?)\s+Copy(?:\s+\d+)?\s*$/);
    return m ? m[1].replace(/\s+$/, '') : null;
}

/* Family members (base name, or base + " Copy [N]") whose movy state file AND
 * backing Move set still exist. Sorted base-first, then shortest, then alpha.
 * Excludes the queried name so it never offers a no-op self-inherit. */
export function findInheritCandidates(
    name: string, idx: Record<string, string>,
): { uuid: string; name: string }[] {
    const base = stripCopySuffix(name);
    if (!base) return [];
    const re = new RegExp('^' + escapeRegex(base) + '(?:\\s+Copy(?:\\s+\\d+)?)?$');
    const out: { uuid: string; name: string }[] = [];
    for (const n in idx) {
        if (n === name || !re.test(n)) continue;
        const uuid = idx[n];
        if (!uuid) continue;
        if (!fileExists(uuidToStatePath(uuid))) continue;
        if (!fileExists(MOVE_SETS_DIR + '/' + uuid)) continue;
        out.push({ uuid, name: n });
    }
    out.sort((a, b) => {
        if (a.name === base) return -1;
        if (b.name === base) return 1;
        if (a.name.length !== b.name.length) return a.name.length - b.name.length;
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return out;
}

export function copyStateFiles(srcUuid: string, dstUuid: string): boolean {
    if (!srcUuid || !dstUuid) return false;
    const st = readFile(uuidToStatePath(srcUuid));
    if (!st) return false;
    ensureDir(dstUuid);
    writeFile(uuidToStatePath(dstUuid), st);
    const ui = readFile(uuidToUiStatePath(srcUuid));
    if (ui) writeFile(uuidToUiStatePath(dstUuid), ui);
    return true;
}

/* The engine state blob to load for `uuid`: own file → best-match inherit
 * (seeded via copy) → blank. */
export function resolveStateBlob(uuid: string, name: string): string {
    const own = readFile(uuidToStatePath(uuid));
    if (own && own.length > 0) return own;
    const cands = findInheritCandidates(name, loadNameIndex());
    if (cands.length > 0 && copyStateFiles(cands[0].uuid, uuid)) {
        const seeded = readFile(uuidToStatePath(uuid));
        if (seeded && seeded.length > 0) return seeded;
    }
    return BLANK_STATE;
}

export function resolveUiBlob(uuid: string): string | null {
    return readFile(uuidToUiStatePath(uuid));
}

/* Per-set writes go under sets/<uuid>/, which host_write_file will NOT create
 * on the device — ensure the directory first (davebox does the same). */
export function writeStateFile(uuid: string, content: string): void {
    ensureDir(uuid);
    writeFile(uuidToStatePath(uuid), content);
}
export function writeUiFile(uuid: string, content: string): void {
    ensureDir(uuid);
    writeFile(uuidToUiStatePath(uuid), content);
}
