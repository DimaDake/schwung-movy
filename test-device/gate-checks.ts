import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SSH_OPTS } from './ssh.js';

const run = promisify(execFile);

/* KNOWN-RED.md: a red check that predates the change under test may be
 * committed past, but only as a LOAN. seq sat red for four days (2026-09-28 ..
 * 10-01) because "pre-existing" was a permanent pass with nobody owning it — so
 * every entry carries the date it went red, and after OVERDUE_DAYS it turns the
 * tier red itself. */
export const OVERDUE_DAYS = 2;

export type KnownRed = { since: string; check: string; owner: string; why: string; ageDays: number };

/** Rows of the file's table whose first cell is a date. Anything else (the
 *  header, prose, the separator) is not an entry. */
export function parseKnownRed(text: string, now: Date): KnownRed[] {
    const out: KnownRed[] = [];
    for (const line of text.split('\n')) {
        const cells = line.split('|').map((c) => c.trim());
        if (cells.length < 6 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[1])) continue;
        const ageDays = Math.floor((now.getTime() - Date.parse(cells[1] + 'T00:00:00Z')) / 86_400_000);
        out.push({ since: cells[1], check: cells[2], owner: cells[3], why: cells[4], ageDays });
    }
    return out;
}

const KNOWN_RED_PATH = () => fileURLToPath(new URL('../../KNOWN-RED.md', import.meta.url));

/** Prints the open entries; returns how many are overdue (each one fails the run). */
export function reportKnownRed(now = new Date(), path = KNOWN_RED_PATH()): number {
    if (!existsSync(path)) return 0;
    const rows = parseKnownRed(readFileSync(path, 'utf8'), now);
    if (!rows.length) return 0;
    let overdue = 0;
    console.log('\nKNOWN-RED.md:');
    for (const r of rows) {
        const late = r.ageDays > OVERDUE_DAYS;
        if (late) overdue++;
        console.log(`  ${late ? 'OVERDUE' : 'open   '} ${r.check} — red since ${r.since} (${r.ageDays}d), ${r.owner}: ${r.why}`);
    }
    if (overdue) console.log(`  ${overdue} entr(ies) older than ${OVERDUE_DAYS} days: fix them, or the user extends them — the tier is RED until then`);
    return overdue;
}

/* A Schwung upgrade on the device changes protocols the harness copies by hand
 * (the UI MIDI ring's write discipline changed in v1.5.0 and seq went red at
 * random for four days). Say so the first run after it moves, so a red sweep
 * is read against the right suspect. */
const LAST_PATH = () => fileURLToPath(new URL('../.last-schwung-version', import.meta.url));

export async function noteSchwungVersion(host: string, path = LAST_PATH()): Promise<void> {
    let v = '';
    try {
        const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${host}`,
            'cat /data/UserData/schwung/host/version.txt']);
        v = stdout.trim();
    } catch { console.log('schwung: version unreadable'); return; }
    const last = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
    if (last && last !== v) {
        console.log(`SCHWUNG CHANGED on the device: ${last} -> ${v}. If anything goes red, re-check the harness's `
            + 'copies of schwung internals first (device-agent/ui-agent.py vs src/host/ui_midi_ring.h, shm offsets).');
    } else {
        console.log(`schwung: ${v}`);
    }
    writeFileSync(path, v + '\n');
}
