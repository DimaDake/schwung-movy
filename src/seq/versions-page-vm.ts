/* What the BACKUPS page draws — computed without pixels, so the wording and the
 * time labels are testable on their own. */

import { versionRows } from './version-wire.js';
import type { VersionWhy } from './version-index.js';

export interface VersionsRowVM {
    age: string; why: string; clips: string; seqOnly: boolean;
}
export interface VersionsPageVM {
    rows: VersionsRowVM[]; selected: number; confirming: boolean; empty: boolean;
}

/* Short on purpose: three columns share 128 pixels, and the reason is the least
 * load-bearing of them. PRE- rather than BEFORE because "WIPE" alone reads as
 * what this version IS rather than what it came before. */
const WHY_LABEL: Record<VersionWhy, string> = {
    'open': 'OPENED', 'auto': 'AUTOSAVE', 'exit': 'ON EXIT',
    'pre-wipe': 'PRE-WIPE', 'pre-restore': 'PRE-UNDO', 'adopted': 'FOUND',
};

const MIN = 60_000, HOUR = 3600_000, DAY = 24 * HOUR;

/** Relative time, because absolute dates neither fit nor help at this size.
 *
 *  A timestamp that is missing, zero or in the future cannot be aged — say
 *  OLDEST rather than invent a date. The list is ordered by generation and
 *  never by the clock, so an unusable one costs only its label. */
export function agoLabel(ms: number, now: number): string {
    if (!(ms > 0) || ms > now) return 'OLDEST';
    const d = now - ms;
    if (d < MIN) return 'JUST NOW';
    if (d < HOUR) return Math.floor(d / MIN) + 'M AGO';
    if (d < DAY) return Math.floor(d / HOUR) + 'H AGO';
    if (d < 2 * DAY) return 'YESTERDAY';
    return Math.floor(d / DAY) + 'D AGO';
}

/** `uuid` is passed in rather than read here: this module would otherwise
 *  import the set lifecycle, which imports the capture layer, which imports the
 *  store this reads — a cycle through the bundle for one string. */
export function buildVersionsPageVM(now: number, uuid: string): VersionsPageVM {
    const rows = versionRows(uuid).map((r) => ({
        age: agoLabel(r.ms, now),
        why: WHY_LABEL[r.why],
        clips: r.clips === 1 ? '1 CLIP' : r.clips + ' CLIPS',
        /* Neither half: the sequence comes back and everything else stays as
         * it is. A version carrying chains alone still restores instruments. */
        seqOnly: !r.ui && !r.ch,
    }));
    return { rows, selected: 0, confirming: false, empty: rows.length === 0 };
}
