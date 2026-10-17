/* Putting a version back.
 *
 * The engine holds the files, so it takes the pre-restore capture, bumps the
 * generation above everything on disk and hands the ui half back; this side
 * only asks and waits. */

import { paramGet, paramSet } from '../host/param.js';
import { mlog } from '../log.js';
import { refreshVersionRows } from './version-wire.js';
import { writeUiBlob } from './persist-store.js';

/* A restore cannot be awaited: the saver is another thread and this host has no
 * sleep. So the press sends the command and a later tick collects the answer —
 * the same shape settling uses for module loads. */
/* A manual set migration hands the open Set back on the same key (`vui`) and
 * wants the same reload, so it waits here too — with its own bound, since it
 * copies every Set from Move rather than a handful of files, and with one more
 * answer: `kept`, the open Set was not one it replaced. */
let pending: { uuid: string; n: number; tries: number; kind: 'restore' | 'migrate' } | null = null;

/* ~2.5 s at the tick rate this runs at. A restore is a handful of file
 * operations; a bound this loose only ever fires when something is wrong, and
 * firing is what stops the page waiting forever. */
const RESTORE_TRIES = 60;
/* Minutes, not seconds: dozens of Sets each copied with their history. */
const MIGRATE_TRIES = 12000;

/** True on the tick a restore completed: the caller re-enters the load. */
export function restoreTick(): boolean {
    if (!pending) return false;
    const v = paramGet('vui');
    if (v === null || v === 'pending') {
        if (++pending.tries < (pending.kind === 'migrate' ? MIGRATE_TRIES : RESTORE_TRIES)) return false;
        mlog(pending.kind + ': never answered — giving up');
        pending = null;
        return false;
    }
    const { uuid, n, kind } = pending;
    pending = null;
    refreshVersionRows();
    if (kind === 'migrate') {
        mlog('migrate: done' + (v === 'kept' ? ', open Set ' + uuid + ' not replaced' : ', open Set ' + uuid + ' replaced'));
        if (v === 'kept' || v === 'failed') return false;
        if (v !== 'none' && v.length > 0) writeUiBlob(uuid, v);
        return true;
    }
    if (v === 'failed') {
        mlog('versions: the engine refused the restore');
        return false;
    }
    /* Logged HERE, not by the engine that did the work: a device run showed
     * that `host::log` from the saver thread never reaches debug.log, while the
     * same call from the audio thread does. The restore is a user action and
     * has to leave a trace, so the trace is the UI's. */
    mlog('versions: restored ' + n + ' of ' + uuid);
    /* The version's ui half, written to the UI's own file: that half is ours
     * (spec §5), and the reload that follows applies it the way an ordinary
     * load would. `none` means the version carried none — an adopted older
     * sequence — and the chains stay as they are. */
    if (v !== 'none' && v.length > 0) writeUiBlob(uuid, v);
    return true;
}

/** Wait for a manual migration's answer for the open Set `uuid`. */
export function awaitMigration(uuid: string): void {
    pending = { uuid, n: 0, tries: 0, kind: 'migrate' };
}

export function migrationPending(): boolean {
    return pending !== null && pending.kind === 'migrate';
}

export function resetVersionRestore(): void {
    pending = null;
}

/** Ask the engine to restore version `n`. It finishes on a later tick:
 *  `restoreTick` says when, and the caller reloads then. */
export function restoreVersion(uuid: string, n: number): void {
    paramSet('set', 'restore ' + n);
    pending = { uuid, n, tries: 0, kind: 'restore' };
}
