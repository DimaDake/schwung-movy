/* TS port of scripts/lib/test-set.sh — the known device state every scenario
 * starts from.
 *
 * Before this existed (in bash), suites asserted against whatever the device
 * happened to hold and mutated it for each other, so results depended on run
 * order. The behaviours encoded below were learned on hardware and are NOT
 * simplifications to revisit; each carries the comment explaining why.
 *
 * The slot operations still go through the in-repo node scripts the bash
 * version calls (scripts/slots-read.mjs, slot-state.mjs, engine-param.mjs).
 * What is ported here is the ORCHESTRATION — the retries, the ordering, and
 * the read-backs — not the WebSocket layer, which already works.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Transport } from './transport.js';
import { until } from './wait.js';
import { SSH_OPTS } from './ssh.js';
import { timed } from './timing.js';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const MOVY = join(HERE, '..', '..');
const FIXTURE_DIR = join(MOVY, 'scripts', 'fixtures', 'device-set');

let HOST = 'move.local';
export function setHost(h: string): void { HOST = h; }

async function ssh(cmd: string): Promise<string> {
    const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${HOST}`, cmd],
                                 { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
}

async function scpTo(local: string, remote: string): Promise<void> {
    await run('scp', ['-q', ...SSH_OPTS, local, `ableton@${HOST}:${remote}`]);
}

/* The chains, read out of the fixture's declaration that chains.json is
 * rendered from — ONE source, so the fixture and the checks cannot disagree. */
export function chainEntries(): Array<{ track: string; comp: string; mod: string }> {
    const o = JSON.parse(readFileSync(join(FIXTURE_DIR, 'ui-state.json'), 'utf8'));
    const out: Array<{ track: string; comp: string; mod: string }> = [];
    for (const t of o.chains ?? []) {
        for (const c of t.comp ?? []) out.push({ track: String(t.t), comp: c.c, mod: c.m });
    }
    return out;
}

/* The synth the fixture puts on a track. A suite that asserts on the instrument
 * must ASK rather than writing `plaits` down: a hard-coded id is how an
 * assertion silently stops describing the fixture it runs against. */
export function fixtureSynth(track: number): string {
    return chainEntries().find((e) => e.track === String(track) && e.comp === 'synth')?.mod ?? '';
}

/* movy-host opens the library's `current` Set, so the fixture owns ONE library
 * Set and pins it as `current` before every open. */
const LIB_ROOT = '/data/UserData/UserLibrary/Movy';
export const LIB_FIXTURE_ID = 'movy-fixture';
/* Where movy keeps the fixture Set's seq-state.json / ui-state.json /
 * versions. `_uuid` is kept for the call sites; there is one library Set. */
export function movySetDir(_uuid = ''): string { return `${LIB_ROOT}/Sets/${LIB_FIXTURE_ID}`; }

/* movy-host must be down (the engine rewrites library.json while it runs). */
async function pinLibrary(): Promise<void> {
    let lib: any = { v: 1, current: '', imported: [], sets: [] };
    try { lib = JSON.parse(await ssh(`cat '${LIB_ROOT}/library.json'`)); } catch { /* none yet */ }
    lib.current = LIB_FIXTURE_ID;
    lib.sets = (lib.sets ?? []).filter((e: any) => e.id !== LIB_FIXTURE_ID);
    lib.sets.push({ id: LIB_FIXTURE_ID, name: 'movy-fixture', created: 1, clips: 0 });
    const tmp = mkdtempSync(join(tmpdir(), 'movy-lib-'));
    try {
        const f = join(tmp, 'library.json');
        writeFileSync(f, JSON.stringify(lib) + '\n');
        await ssh(`mkdir -p '${LIB_ROOT}/Sets/${LIB_FIXTURE_ID}' && chmod 777 '${LIB_ROOT}/Sets/${LIB_FIXTURE_ID}'`);
        await scpTo(f, `${LIB_ROOT}/library.json.new`);
        await ssh(`mv '${LIB_ROOT}/library.json.new' '${LIB_ROOT}/library.json'`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
}

export async function activeUuid(): Promise<string> { return LIB_FIXTURE_ID; }

/* The sequencer half: known tempo/swing, clips, and a pre-seeded automation
 * lane. Movy must be CLOSED first — prefs are cached for the life of one open
 * and the per-set blobs are autosaved over within seconds of it running. */
export function installMovyState(): Promise<void> { return timed('fixture.install', installMovyStateInner); }

async function installMovyStateInner(): Promise<void> {
    await pinLibrary();
    const dir = movySetDir();
    const p = `${dir}/seq-state.json`;
    /* Delete before writing. Movy's own saves go through the host, which runs
     * as ROOT, so a set movy has saved holds root-owned 644 files — and scp
     * opens the destination for writing, so it is refused however writable the
     * directory is. The directory is ableton's, so unlinking is allowed. */
    /* The freeze files go too: a track left frozen (by hand on the box, or a
     * scenario that died mid-freeze) opens frozen, its chain unloaded — and
     * the fixture's chain check then fails for every scenario after it. */
    await ssh(`mkdir -p '${dir}' && rm -rf '${p}' '${dir}/ui-state.json' '${dir}/chains.json' '${dir}/freeze.txt' '${dir}/freeze'`);
    await scpTo(join(FIXTURE_DIR, 'seq-state.json'), p);

    /* Two more per-set files, both rendered from the fixture's declaration:
     * ui-state.json (mute/solo, root, scale, layout, per-track octave) and
     * chains.json (the movy-hosted chains — the engine's file, and the only one
     * a load reads chains from). Each chain component's preset blob is filled
     * in from the same slot_<N>.json the schwung half restores from, so the two
     * cannot drift into testing different sounds. */
    const tmp = mkdtempSync(join(tmpdir(), 'movy-fix-'));
    try {
        for (const [name, args] of [['ui-state.json', []], ['chains.json', ['--chains']]] as const) {
            const { stdout } = await run('node', [join(MOVY, 'scripts/fixture-ui-state.mjs'), FIXTURE_DIR, ...args],
                                         { maxBuffer: 8 * 1024 * 1024 });
            const f = join(tmp, name);
            writeFileSync(f, stdout);
            await scpTo(f, `${dir}/${name}`);
        }
    } finally { rmSync(tmp, { recursive: true, force: true }); }

    /* The rotating shadow copies outrank a lower-generation canonical file, so
     * a stale pair would be restored right back over the fixture on next open. */
    await ssh(`rm -f '${dir}/seq-state.1.json' '${dir}/seq-state.2.json'`);
}

/* A one-line summary of the per-set blob: how many automation lanes and clips
 * it holds, its generation and size. Diagnostic — a scenario can note this at
 * each stage and see exactly where state stops surviving. */
export async function blobInfo(): Promise<string> {
    const f = `${movySetDir()}/seq-state.json`;
    return (await ssh(
        `F=${f}; printf 'au=%s cl=%s %s size=%s' ` +
        `"$(grep -c '^au ' $F 2>/dev/null)" "$(grep -c '^cl ' $F 2>/dev/null)" ` +
        `"$(grep '^gen ' $F 2>/dev/null || echo gen0)" "$(wc -c < $F 2>/dev/null)"`)).trim();
}

/* Ask the engine what each movy chain HOLDS. `chloadedlog` is write-to-read, so
 * wait for the poke's OWN line — the previous one describes a chain from before
 * whatever the caller just did. */
export async function chloaded(tx: Transport): Promise<string | null> {
    const countBefore = (await tx.logGrep('chain loaded:')).length;
    await tx.engineSetQueued('chloadedlog', '1');
    try {
        const line = await until(tx, 'chloadedlog answer', async () => {
            const lines = await tx.logGrep('chain loaded:');
            return lines.length > countBefore ? lines[lines.length - 1] : null;
        }, (v) => v !== null, { within: 3500, every: 300 });
        return line;
    } catch { return null; }
}

export function verifyChains(tx: Transport, open: () => Promise<void>,
                             close: () => Promise<void>): Promise<boolean> {
    return timed('fixture.verifyChains', () => verifyChainsInner(tx, open, close));
}

async function verifyChainsInner(tx: Transport, open: () => Promise<void>,
                                  close: () => Promise<void>): Promise<boolean> {
    const want = chainEntries();
    if (!want.length) return true;

    /* Movy has to be OPEN for any of it: the set restore is what issues the
     * loads, and the overtake DSP is unloaded on exit. It is closed again
     * afterwards because every suite expects to do the FIRST open itself —
     * several assert on lines only a fresh open writes. */
    await open();
    let report: string | null = null;
    try {
        await until(tx, 'movy chains to reach the fixture', async () => {
            /* Swallow a transient here rather than letting it out. The restore
             * takes seconds and this polls across it, so ONE failed ssh or a
             * `chloadedlog` poke that lands mid-restart would otherwise abort
             * the whole wait and report "never reached the fixture" about a
             * chain that was about to arrive — measured: the chains restored
             * seven seconds AFTER the report this gave up on. */
            try {
                report = await chloaded(tx);
                if (!report) return false;
                /* No trailing `?`: that marks a component the engine was asked
                 * for and never instantiated. */
                return want.every((w) =>
                    new RegExp(`(^| )${w.track}:${w.comp}=${w.mod}( |$)`).test(report!));
            } catch { return false; }
        }, (okv) => okv === true, { within: 20000, every: 600 });
        return true;
    } catch {
        console.error('fixture: movy chains never reached the fixture');
        console.error(`  wanted: ${want.map((w) => `${w.track}:${w.comp}=${w.mod}`).join(' ')}`);
        console.error(`  engine: ${report ?? '<no chloadedlog answer>'}`);
        return false;
    } finally { await close().catch(() => {}); }
}

/* Apply, then confirm; retry the whole thing if it did not land.
 *
 * Verify FIRST: the chain is usually ALREADY at the fixture (the previous run
 * left it there), and re-loading modules that are already loaded cost ~60 s per
 * suite for no change.
 *
 * SIX attempts, not three. A module load is a set_param into the chain host's
 * single-slot param SHM, where a write can simply be DROPPED rather than merely
 * slow — so an attempt failing says nothing about the next. Three was
 * demonstrably marginal: one suite in a sweep recovered on attempt 3 while
 * another gave up at the same boundary. */
/* The second installMovyState() is not redundant.
 *
 * verifyChains has to OPEN movy (the set restore is what issues the chain
 * loads) and closes it again afterwards — and movy SAVES on close. If the
 * sequencer restore has not finished by then, that save writes an emptier
 * blob straight over the fixture we just installed: measured, au=1 cl=2
 * size=670 became au=0 cl=0 size=209, and the scenario then ran with no
 * automation lane and no clips.
 *
 * The bash version has the same ordering and never showed it, because its
 * close was `Back x3`, which does not actually close movy — so no save on
 * close ever happened. Making close() work is what exposed this.
 *
 * So the fixture gets the last word: re-install after movy has finished
 * touching the blob. Cheap (two scp) and idempotent. */
let chainsProven = false;

export async function ensure(tx: Transport, open: () => Promise<void>,
                             close: () => Promise<void>): Promise<void> {
    /* There are no schwung slots to seed or verify: the fixture is movy's own
     * half — its library Set's files and its chains. */
    await close().catch(() => {});
    await installMovyState();
    /* The bytes installed are identical every time, and the engine loads them
     * the same way, so one proof per process is the proof: repeating it cost
     * an open + poll + close (~8 s) in front of EVERY scenario. */
    if (!chainsProven) {
        if (!await verifyChains(tx, open, close)) throw new Error('fixture: movy chains not established');
        chainsProven = true;
        await installMovyState();   // see the note above
    }
}
