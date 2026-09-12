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
import type { Bus } from './bus.js';
import { until } from './wait.js';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const MOVY = join(HERE, '..', '..');
const FIXTURE_DIR = join(MOVY, 'scripts', 'fixtures', 'device-set');
export const DEVICE_DIR = '/data/UserData/schwung/_movy-fixture';
const SSH_OPTS = ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes'];

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

/* Every node helper inherits HOST from the ENVIRONMENT (process.env.HOST),
 * while the suites pass the address as an argument. Without this a run against
 * another device would ssh to the right box and WebSocket to move.local. */
async function node(script: string, args: string[]): Promise<{ out: string; code: number }> {
    try {
        const { stdout } = await run('node', [join(MOVY, 'scripts', script), ...args],
                                     { env: { ...process.env, HOST }, maxBuffer: 8 * 1024 * 1024 });
        return { out: stdout.trim(), code: 0 };
    } catch (e: any) {
        return { out: String(e?.stdout ?? '').trim(), code: e?.code ?? 1 };
    }
}

/* "<slot> <module>" per line, comments and blanks stripped. ONE parser, so
 * apply and verify can never disagree about what the fixture describes. */
export function fixtureEntries(): Array<{ slot: string; mod: string }> {
    return readFileSync(join(FIXTURE_DIR, 'slots.txt'), 'utf8')
        .split('\n')
        .map((l) => l.replace(/#.*/, '').trim())
        .filter(Boolean)
        .map((l) => { const [slot, mod] = l.split(/\s+/); return { slot, mod }; });
}

/* The movy-hosted half, read out of the same ui-state.json movy itself restores
 * from — same one-parser rule as fixtureEntries. */
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

export async function activeUuid(): Promise<string> {
    return (await ssh('head -n 1 /data/UserData/schwung/active_set.txt 2>/dev/null || true')).trim();
}

/* All four slots over ONE WebSocket. Reading them one at a time meant four
 * connections per pass and two passes per attempt, which is what made
 * establishing the fixture the most expensive thing a device test did.
 *
 * Exit 3 means at least one slot never answered. Silence must NEVER be read as
 * "empty" — that is how a verify accepts a slot that never loaded. */
async function readSlots(): Promise<string[] | null> {
    const { out, code } = await node('slots-read.mjs', []);
    if (code !== 0 || !out) return null;
    return out.split('\n').map((l) => l.trim()).filter(Boolean).sort();
}

/* Read every slot back and compare. Never INFER that an apply worked: running
 * on the wrong state while reporting success is the failure this exists to
 * remove. */
export async function verify(quiet = false): Promise<boolean> {
    const want = fixtureEntries()
        .map((e) => `${e.slot} ${e.mod === 'none' ? '-' : e.mod}`).sort();
    const got = await readSlots();
    if (!got) { if (!quiet) console.error('fixture: no answer reading the chain'); return false; }
    if (want.join('|') !== got.join('|')) {
        if (!quiet) {
            console.error(`fixture: chain is [${got.join(' ')}], fixture wants [${want.join(' ')}]`);
        }
        return false;
    }
    return true;
}

/* Ship the fixture to a directory schwung does not own. Anything kept under
 * set_state/<uuid>/ is autosaved over with whatever is currently loaded, so a
 * fixture stored there quietly becomes a copy of the last test's mess. */
async function pushFixture(): Promise<void> {
    await ssh(`mkdir -p ${DEVICE_DIR}`);
    for (const { slot, mod } of fixtureEntries()) {
        if (mod === 'none') continue;
        await scpTo(join(FIXTURE_DIR, `slot_${slot}.json`), `${DEVICE_DIR}/slot_${slot}.json`);
    }
}

/* Wait until a slot reports the module we asked for. Chain loads settle at
 * their own pace — under a second to several — so a fixed sleep either wastes
 * time or gives up too early; both happened before this polled. */
async function waitSlot(bus: Bus, slot: string, want: string): Promise<boolean> {
    try {
        await until(bus, `slot ${slot} == ${want || 'empty'}`, async () => {
            const { out, code } = await node('module-slot.mjs', ['get', slot, 'synth']);
            return code === 0 ? out : null;
        }, (v) => v === want, { within: 7000, every: 300 });
        return true;
    } catch { return false; }
}

async function apply(bus: Bus): Promise<void> {
    for (const { slot, mod } of fixtureEntries()) {
        if (mod === 'none') {
            await node('slot-state.mjs', ['clear', slot]);
            await waitSlot(bus, slot, '');
            continue;
        }
        /* load_file acts on the slot's EXISTING chain instance: it is a no-op
         * on an empty slot, and on a slot holding a DIFFERENT module it empties
         * the slot rather than switching it. So put the right module in place
         * first whenever the slot does not already hold it; load_file then
         * restores that module's parameter values on top. */
        const cur = await node('module-slot.mjs', ['get', slot, 'synth']);
        if (cur.out !== mod) {
            await node('slot-state.mjs', ['module', slot, mod]);
            if (!await waitSlot(bus, slot, mod)) continue;   // let the outer retry re-try
        }
        await node('slot-state.mjs', ['load', slot, `${DEVICE_DIR}/slot_${slot}.json`]);
        await waitSlot(bus, slot, mod);
    }
}

/* True when every chain slot reads empty while the fixture wants a module in at
 * least one — the single state no number of applies can leave. A device that
 * does not ANSWER is not cold: silence is unknown, and seeding on it would
 * restart the stack for nothing. */
async function chainIsCold(): Promise<boolean> {
    if (!fixtureEntries().some((e) => e.mod !== 'none')) return false;
    const got = await readSlots();
    if (!got) return false;
    return got.every((l) => l.trim().endsWith(' -'));
}

/* Seed the shim's BOOT path with the fixture, then restart.
 *
 * The remote-UI route `apply` uses cannot load the FIRST module into a slot: a
 * web set-ring write reaches the chain plugin only when the slot is already
 * active, so `synth:module` into an empty slot is dropped with no error and a
 * cheerful success. A device rebooted on an unsaved set comes up exactly there,
 * and the attempts below then cost ~110 s each while never being able to work.
 *
 * The shim's boot has no such gate — it load_file's each slot_N.json itself. So
 * write the fixture where boot reads it, in the restart's DOWN window, because
 * the running shim autosaves over that directory. */
async function seedBootState(): Promise<void> {
    const uuid = await activeUuid();
    const dir = uuid ? `/data/UserData/schwung/set_state/${uuid}`
                     : '/data/UserData/schwung/slot_state';
    await ssh('mkdir -p /tmp/ts-seed');
    for (const { slot, mod } of fixtureEntries()) {
        if (mod === 'none') {
            /* "{}" is what the shim itself autosaves for an empty slot. */
            await ssh(`echo '{}' > /tmp/ts-seed/slot_${slot}.json`);
        } else {
            await scpTo(join(FIXTURE_DIR, `slot_${slot}.json`), `/tmp/ts-seed/slot_${slot}.json`);
        }
    }
    /* The restart-with-a-command-in-the-down-window logic lives in
     * scripts/lib/restart-stack.sh: it runs as ROOT (MoveOriginal is root's, so
     * a restart as `ableton` pkills nothing and still exits 0) and compares
     * PIDs, because restart-move.sh detaches and sleeps before killing
     * anything — so "a process exists" is not proof a restart happened. */
    await run('bash', ['-c',
        `set -e; HOST=${HOST}; . "${join(MOVY, 'scripts/lib/restart-stack.sh')}"; ` +
        `restart_move_stack "${HOST}" 'mkdir -p ${dir} && cp /tmp/ts-seed/slot_*.json ${dir}/'`],
        { maxBuffer: 8 * 1024 * 1024 });
}

/* The sequencer half: known tempo/swing, clips, and a pre-seeded automation
 * lane. Movy must be CLOSED first — prefs are cached for the life of one open
 * and the per-set blobs are autosaved over within seconds of it running. */
export async function installMovyState(): Promise<void> {
    const uuid = await activeUuid();
    const dir = `/data/UserData/schwung/modules/tools/movy/sets/${uuid || '_default'}`;
    const p = `${dir}/seq-state.json`;
    /* Delete before writing. Movy's own saves go through the host, which runs
     * as ROOT, so a set movy has saved holds root-owned 644 files — and scp
     * opens the destination for writing, so it is refused however writable the
     * directory is. The directory is ableton's, so unlinking is allowed. */
    await ssh(`mkdir -p '${dir}' && rm -f '${p}' '${dir}/ui-state.json'`);
    await scpTo(join(FIXTURE_DIR, 'seq-state.json'), p);

    /* ui-state.json is a SECOND per-set file (mute/solo, root, scale, layout,
     * per-track octave, the movy-hosted chains). Rendered, not copied: each
     * chain component's preset blob is filled in from the same slot_<N>.json
     * the schwung half restores from, so the two cannot drift into testing
     * different sounds. */
    const tmp = mkdtempSync(join(tmpdir(), 'movy-fix-'));
    try {
        const { stdout } = await run('node', [join(MOVY, 'scripts/fixture-ui-state.mjs'), FIXTURE_DIR],
                                     { maxBuffer: 8 * 1024 * 1024 });
        const f = join(tmp, 'ui-state.json');
        writeFileSync(f, stdout);
        await scpTo(f, `${dir}/ui-state.json`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }

    /* The rotating shadow copies outrank a lower-generation canonical file, so
     * a stale pair would be restored right back over the fixture on next open. */
    await ssh(`rm -f '${dir}/seq-state.1.json' '${dir}/seq-state.2.json'`);
    /* And chains.json, which with `engpersist` on is the AUTHORITY for the movy
     * chains — ui-state.json's copy is only a mirror (spec §6.1). Seeding the
     * mirror while the previous run's authority survived meant a scenario ran
     * on whatever modules the last one left: the fixture asked for plaits on
     * track 0 and the engine reported rex, which reads as "movy chains never
     * reached the fixture". Removing it puts the Set in the shape the engine's
     * compatibility path expects — no chains.json, chains read from the ui blob
     * — which is also what every Set written before this feature looks like.
     * Mirrors scripts/lib/test-set.sh, which carries the same fix. */
    await ssh(`rm -f '${dir}/chains.json'`);
}

/* The per-set sequencer blob's mtime. Movy persists on its own schedule (~8 s
 * of device time), so a scenario that closes right after a take can find there
 * was nothing saved to restore — which looks exactly like a broken restore.
 * Watching the mtime tells the two apart. */
export async function seqStateMtime(): Promise<string> {
    const uuid = await activeUuid();
    const p = `/data/UserData/schwung/modules/tools/movy/sets/${uuid || '_default'}/seq-state.json`;
    return (await ssh(`ls -l '${p}' 2>/dev/null || true`)).trim();
}

/* A one-line summary of the per-set blob: how many automation lanes and clips
 * it holds, its generation and size. Diagnostic — a scenario can note this at
 * each stage and see exactly where state stops surviving. */
export async function blobInfo(): Promise<string> {
    const uuid = await activeUuid();
    const f = `/data/UserData/schwung/modules/tools/movy/sets/${uuid || '_default'}/seq-state.json`;
    return (await ssh(
        `F=${f}; printf 'au=%s cl=%s %s size=%s' ` +
        `"$(grep -c '^au ' $F 2>/dev/null)" "$(grep -c '^cl ' $F 2>/dev/null)" ` +
        `"$(grep '^gen ' $F 2>/dev/null || echo gen0)" "$(wc -c < $F 2>/dev/null)"`)).trim();
}

/* Ask the engine what each movy chain HOLDS. `chloadedlog` is write-to-read, so
 * wait for the poke's OWN line — the previous one describes a chain from before
 * whatever the caller just did. */
export async function chloaded(bus: Bus): Promise<string | null> {
    const countBefore = Number(
        (await ssh("grep -c 'chain loaded:' /data/UserData/schwung/debug.log 2>/dev/null || echo 0")).trim()) || 0;
    await node('engine-param.mjs', ['set', 'chloadedlog', '1', HOST]);
    try {
        const line = await until(bus, 'chloadedlog answer', async () => {
            const out = await ssh("grep 'chain loaded:' /data/UserData/schwung/debug.log 2>/dev/null || true");
            const lines = out.split('\n').filter((l) => l.includes('chain loaded:'));
            return lines.length > countBefore ? lines[lines.length - 1] : null;
        }, (v) => v !== null, { within: 3500, every: 300 });
        return line;
    } catch { return null; }
}

export async function verifyChains(bus: Bus, open: () => Promise<void>,
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
        await until(bus, 'movy chains to reach the fixture', async () => {
            /* Swallow a transient here rather than letting it out. The restore
             * takes seconds and this polls across it, so ONE failed ssh or a
             * `chloadedlog` poke that lands mid-restart would otherwise abort
             * the whole wait and report "never reached the fixture" about a
             * chain that was about to arrive — measured: the chains restored
             * seven seconds AFTER the report this gave up on. */
            try {
                report = await chloaded(bus);
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
export async function ensure(bus: Bus, open: () => Promise<void>,
                             close: () => Promise<void>): Promise<void> {
    if (await verify(true)) {
        await close().catch(() => {});
        await installMovyState();
        if (!await verifyChains(bus, open, close)) throw new Error('fixture: movy chains not established');
        await installMovyState();   // see the note below
        return;
    }

    await pushFixture();
    /* Movy must be shut before the sequencer state is written, or it autosaves
     * its in-memory copy straight back over the fixture within seconds. */
    await close().catch(() => {});
    await installMovyState();

    if (await chainIsCold()) await seedBootState();

    for (let attempt = 1; attempt <= 6; attempt++) {
        await apply(bus);
        if (await verify(attempt === 6 ? false : true)) {
            if (!await verifyChains(bus, open, close)) throw new Error('fixture: movy chains not established');
            await installMovyState();   // see the note below
            return;
        }
        await bus.frames(1000);   // ~2.9 s of device frames, not a wall clock
    }
    throw new Error('fixture: could not establish the fixture state');
}
