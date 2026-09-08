#!/usr/bin/env node
/* recover-sets.mjs — put back a set whose sequencer state was blanked.
 *
 *   node scripts/recover-sets.mjs [move.local]           # report only
 *   node scripts/recover-sets.mjs [move.local] --apply   # restore
 *
 * WHAT THIS RECOVERS. The failure screen used to offer "JOG CLICK = START
 * EMPTY" for every failure, including an engine that never started — where the
 * set is intact and blanking it cannot help. A user who pressed the jog to get
 * past that screen wrote BLANK_STATE over their sequencer state.
 *
 * WHY IT IS RECOVERABLE AT ALL. `writeStateBlob` writes a rotating shadow
 * (`seq-state.1.json` / `seq-state.2.json`) BEFORE the canonical file, and the
 * rotation restarts at slot 1 for each session. So a blank write lands in slot
 * 1 and the canonical file, and slot 2 still holds the last good save.
 *
 * WHICH MEANS THIS IS TIME-LIMITED: the next write goes to slot 2. One blank
 * costs nothing, two overwrite the copy this script reads. Run it before
 * reopening the set.
 *
 * The envelope's generation is what `readBestState` orders copies by, so the
 * rescued payload is rewritten one generation ABOVE every copy on disk —
 * anything less and the blank keeps winning. Nothing is deleted: the blank
 * stays in its shadow slot, outranked.
 */

import { execFileSync } from 'node:child_process';
import { wrapState, parseState } from '../dist/esm/seq/persist-blob.js';

const HOST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'move.local';
const APPLY = process.argv.includes('--apply');
const SETS = '/data/UserData/schwung/modules/tools/movy/sets';

const ssh = (cmd) =>
    execFileSync('ssh', ['-o', 'ConnectTimeout=5', `ableton@${HOST}`, cmd],
                 { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/* A set with no `cl` line has no notes in it — which is what a blank looks like
 * from here, and also what a genuinely empty set looks like. The two are only
 * distinguishable by there being something better on disk, which is exactly
 * what this script goes looking for. */
const hasMusic = (payload) => /^cl \d/m.test(payload || '');

function copies(uuid, files) {
    const out = [];
    for (const [name, raw] of Object.entries(files)) {
        const p = parseState(raw);
        if (p) out.push({ name, ...p });
    }
    return out;
}

let dirs;
try {
    dirs = ssh(`ls ${SETS}`).split('\n').map((s) => s.trim()).filter(Boolean)
        .filter((d) => !d.endsWith('.json'));
} catch (e) {
    console.error(`cannot reach ${HOST}: ${e.message}`);
    process.exit(2);
}

/* One round trip for every file rather than one per set: each ssh costs ~0.5 s,
 * and a device carries dozens of sets. */
const MARK = '@@FILE@@';
const paths = [];
for (const d of dirs)
    for (const f of ['seq-state.json', 'seq-state.1.json', 'seq-state.2.json'])
        paths.push(`${SETS}/${d}/${f}`);
const blob = ssh(paths.map((p) => `echo "${MARK}${p}"; cat "${p}" 2>/dev/null`).join('; '));

const bySet = {};
for (const chunk of blob.split(MARK).slice(1)) {
    const nl = chunk.indexOf('\n');
    const path = chunk.slice(0, nl).trim();
    const body = chunk.slice(nl + 1);
    const [, uuid, file] = path.match(new RegExp(`${SETS}/([^/]+)/(.+)$`)) || [];
    if (!uuid) continue;
    (bySet[uuid] ||= {})[file] = body;
}

let damaged = 0, fixed = 0;
for (const [uuid, files] of Object.entries(bySet)) {
    const all = copies(uuid, files);
    if (all.length === 0) continue;
    const best = all.reduce((a, b) => (b.gen > a.gen ? b : a));
    if (hasMusic(best.payload)) continue;              // movy would load music: fine

    /* The set movy WOULD load has no notes. Is there an older copy that does? */
    const rescue = all.filter((c) => hasMusic(c.payload))
                      .sort((a, b) => b.gen - a.gen)[0];
    if (!rescue) continue;                             // genuinely an empty set

    damaged++;
    const notes = (rescue.payload.match(/^cl \d/gm) || []).length;
    console.log(`${uuid}: loads EMPTY (gen ${best.gen}) — `
        + `${rescue.name} holds ${notes} clip(s) at gen ${rescue.gen}`);
    if (!APPLY) continue;

    const gen = Math.max(...all.map((c) => c.gen)) + 1;
    const wrapped = wrapState(rescue.payload, gen);
    const tmp = `/tmp/recover-${uuid}.json`;
    execFileSync('ssh', ['-o', 'ConnectTimeout=5', `ableton@${HOST}`,
                         `cat > ${tmp} && cp ${tmp} ${SETS}/${uuid}/seq-state.json && rm -f ${tmp}`],
                 { input: wrapped });
    /* Read it back. A write nobody confirmed is how the state this script
     * exists to undo was lost in the first place. */
    const back = ssh(`cat ${SETS}/${uuid}/seq-state.json`);
    if (parseState(back)?.payload === rescue.payload) {
        console.log(`  restored at gen ${gen}`);
        fixed++;
    } else {
        console.log('  RESTORE FAILED — the file on disk does not match');
    }
}

if (damaged === 0) {
    console.log(`no blanked sets on ${HOST} (${Object.keys(bySet).length} checked)`);
} else if (!APPLY) {
    console.log(`\n${damaged} set(s) recoverable — re-run with --apply to restore them.`);
    console.log('Do it with movy CLOSED: an autosave rotates the shadow slot the '
                + 'rescue copy lives in.');
} else {
    console.log(`\n${fixed}/${damaged} restored.`);
}
