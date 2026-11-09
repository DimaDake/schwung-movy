/* Freeze memory on the device: a loop's RAM goes back when the loop goes.
 * movy-host runs mlockall, so every page it keeps is locked RAM, and glibc's
 * malloc keeps freed buffers once its mmap threshold has ratcheted past a
 * loop's size (host/rt.c, `mallopt`). The freeze bank's own bookkeeping is
 * pinned in the cargo tests; only the box shows what the process holds.
 *
 * Covers:
 *   M1 a freeze then a thaw, three times over, hands the loops' RAM back each time
 *   M2 reopening a frozen Set holds one Set's loops, not the old and new together
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { CC_PLAY, CC_DELETE, STEP_NOTE_BASE, PAD_NOTE_BASE } from '../midi.js';
import { SSH_OPTS } from '../ssh.js';

const run = promisify(execFile);
const ACT = 90;
/* What an idle movy-host's RSS wanders by between two reads. */
const SLACK_MB = 2;

const field = (s: string, k: string) => s.match(new RegExp(`(?:^| )${k}=(\\S+)`))?.[1] ?? '';
const frozenBit0 = (s: string) => (parseInt(field(s, 'frz'), 16) & 1) === 1;

scenario('freeze-mem', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const open = () => dev.open(probe);
    const close = () => dev.close(probe);
    const status = () => t.tx.engineGet('status').catch(() => '');
    const ssh = async (cmd: string) =>
        (await run('ssh', [...SSH_OPTS, `ableton@${t.host}`, cmd])).stdout.trim();
    const wait = async <T>(what: string, read: () => Promise<T>, pred: (v: T) => boolean, within: number) => {
        try { return await until(t.tx, what, read, pred, { within, every: 150 }); } catch { return read(); }
    };
    /* movy-host's own RSS, in MB (a forked emulator shares the executable but
     * not the comm). */
    const rss = async () => Number(await ssh(
        `for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = movy-host ] && sed -n 's/^VmRSS:[^0-9]*\\([0-9]*\\).*/\\1/p' $p/status; done | head -n 1`)) / 1024;
    /* Read once the helper has had its blocks to free or fault in. */
    const settled = async () => { await t.tx.frames(400); return rss(); };
    const synth0 = fixture.fixtureSynth(0);
    const chainBack = (l: string) => l.includes(`0:synth=${synth0}`) && !l.includes(`0:synth=${synth0}?`);

    await fixture.ensure(t.tx, open, close);
    await dev.deployUi();
    await open();
    t.need.register(async () => {
        if (frozenBit0(await status())) await t.tx.engineSet('unfrz', '0');
    });

    await dev.selectTrack(0);
    if (field(await status(), 'play') === '1') await dev.tap.cc(CC_PLAY);
    await dev.tap.note(PAD_NOTE_BASE, 100);
    await dev.tap.cc(CC_DELETE);
    await t.tx.frames(ACT);
    for (const s of [0, 4, 8, 12]) { await dev.tap.note(STEP_NOTE_BASE + s, 127); await t.tx.frames(ACT); }
    await t.tx.engineSet('cmd', 'clen 0 128;clipsel 0 1;tog 0 0 64 100;clen 0 128;clipsel 0 0');
    await t.tx.frames(ACT);

    const freeze = async () => {
        await t.tx.engineSet('cmd', 'play');
        await wait('the transport to start', status, (s) => field(s, 'play') === '1', 3000);
        await t.tx.engineSet('frz', '0');
        const s = await wait('track 0 to freeze', status, (v) => frozenBit0(v) && field(v, 'frzc') === '-', 60000);
        await t.tx.engineSet('cmd', 'stop');
        await wait('the transport to stop', status, (v) => field(v, 'play') === '0', 3000);
        return frozenBit0(s);
    };
    const thaw = async () => {
        await t.tx.engineSet('unfrz', '0');
        await wait('track 0 to thaw', status, (s) => !frozenBit0(s), 8000);
        return chainBack(await wait('the chain back', async () => (await fixture.chloaded(t.tx)) ?? '', chainBack, 8000));
    };

    // ── M1: freeze, thaw, three times ───────────────────────────────────────
    const base = await settled();
    const frozenAt: number[] = [];
    const thawedAt: number[] = [];
    let cycled = true;
    for (let i = 0; i < 3; i++) {
        cycled &&= await freeze();
        frozenAt.push(await settled());
        cycled &&= await thaw();
        thawedAt.push(await settled());
    }
    /* Thawed against thawed: a freeze also unloads the synth, so frozen
     * against the base says nothing. Measured before the fix (2026-11-09):
     * thawed 113.8/118.9/119.0, the second cycle's loops kept for good. */
    const crept = Math.max(...thawedAt) - thawedAt[0];
    t.note('rssMB', `base ${base.toFixed(1)} frozen ${frozenAt.map((v) => v.toFixed(1)).join('/')} thawed ${thawedAt.map((v) => v.toFixed(1)).join('/')}`);
    t.check('m1-thaw-returns', "each thaw gives the loops' RAM back (three cycles)",
        cycled && crept < SLACK_MB,
        { expected: `every thaw within ${SLACK_MB} MB of the first`, actual: `cycled=${cycled} +${crept.toFixed(1)} MB` });

    // ── M2: a reopen holds one Set's loops ──────────────────────────────────
    const frozen = await freeze();
    await wait('the freeze files', () => ssh(`test -s '${fixture.movySetDir()}/freeze.txt' && echo ok || true`), (v) => v === 'ok', 5000);
    const before = await settled();
    const peaks: number[] = [];
    let reopened = frozen;
    /* Before the fix: 118.7, then 124.1/129.3 — a loop set per reopen.
     * In-process, as a Set switch is: `close` would exit movy and measure a
     * fresh process. Reopening the open Set reads its loops back and drops
     * the ones in hand, the same two halves as a switch to another Set. */
    const uuid = fixture.movySetDir().split('/').pop()!;
    for (let i = 0; i < 2; i++) {
        const applied = field(await status(), 'frze');
        await t.tx.engineSet('set', `open ${uuid}`);
        await t.tx.frames(200);
        reopened &&= frozenBit0(await wait('the reopened Set frozen', status, frozenBit0, 8000));
        t.note(`reopen${i}`, `frze ${applied} -> ${field(await status(), 'frze')}`);
        peaks.push(await settled());
    }
    const grew = Math.max(...peaks) - before;
    t.note('reopenMB', `frozen ${before.toFixed(1)} after reopens ${peaks.map((v) => v.toFixed(1)).join('/')}`);
    t.check('m2-reopen-one-set', "a reopened frozen Set holds its loops once, not on top of the last open's",
        reopened && grew < SLACK_MB,
        { expected: `frozen after each reopen, RSS < +${SLACK_MB} MB`, actual: `reopened=${reopened} +${grew.toFixed(1)} MB` });
});
