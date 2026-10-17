/* The SETS page (Shift+Step 1) end to end: movy's gestures, Schwung's REAL
 * keyboard, the engine's library and its index on disk.
 *
 * browser-test/logic/sets.mjs owns the page's logic against a fake engine and
 * a stand-in keyboard. What only this can show: that the real keyboard opens
 * with what movy handed it and its OK reaches the engine, that a Set made,
 * renamed, copied and deleted here is what the library says after movy is
 * closed and reopened, and that the edit buttons' LEDs say what they do.
 *
 * Every Set it makes it deletes, and the only Sets it opens are its own and the
 * fixture's, so a user's library on the box is listed but never touched.
 *
 * Covers:
 *   S1 the page opens on the open Set; a whole fast spin moves the cursor
 *   S2 the edit buttons are dark on [NEW] and lit on a Set
 *   S3 [NEW] makes a dated Set and opens it
 *   S4 Capture opens the keyboard on a generated two-word name (dated Set)
 *   S5 …with every movy button but Back dark under it
 *   S6 OK renames the Set to it
 *   S7 a named Set opens the keyboard on its own name; Back changes nothing
 *   S8 Copy makes "<name> Copy" and puts the cursor on it
 *   S9 deleting the OPEN Set moves to a neighbour first, then deletes it
 *   S10 after a close and reopen the library still says so
 *   S11 the copy is deleted from the fixture Set, leaving nothing behind
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { cc, CC_BACK, CC_DELETE, CC_JOG_TURN, STEP_NOTE_BASE } from '../midi.js';

const CC_SHIFT = 49, CC_CAPTURE = 52, CC_COPY = 60;
const DIM = 16, OFF = 0;
const DATED = /^\d{4}-\d\d-\d\d_\d+$/;
const PAIR = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
const WAIT = { within: 10000, every: 200 };

type Row = { id: string; name: string };
type Lib = { cur: string; made: string; rows: Row[] };

/* sets-lib.ts:parseLib's wire, read here rather than imported: the harness
 * compiles apart from src/. */
function parseLib(raw: string): Lib | null {
    if (!raw) return null;
    const [head, ...lines] = raw.split('\n');
    const f: Record<string, string> = {};
    for (const tok of head.split(' ')) { const i = tok.indexOf('='); if (i > 0) f[tok.slice(0, i)] = tok.slice(i + 1); }
    if (!(parseInt(f.rev, 10) > 0)) return null;
    const dash = (v?: string) => (!v || v === '-' ? '' : v);
    const rows = lines.map((l) => l.split('\t')).filter((t) => t.length >= 4 && t[0])
        .map((t) => ({ id: t[0], name: t.slice(3).join('\t') }));
    return { cur: dash(f.cur), made: dash(f.made), rows };
}

scenario('sets', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const hb = t.tx.hostBus!;
    /* Through UI_EVAL, not engineGet: the bus's GET answers one LINE, and the
     * library's answer is a header and one line per Set. */
    const lib = async (): Promise<Lib> =>
        parseLib(String(await hb.uiEval(`host_module_get_param('lib') ?? ''`).catch(() => ''))) ?? { cur: '', made: '', rows: [] };
    const sets = async () => await probe.ask({ key: 'sets' }) as
        { view: string; selected: number; confirming: boolean; keyboard: boolean; buffer: string | null };
    const libUntil = (what: string, pred: (l: Lib) => boolean) => until(t.tx, what, lib, pred, WAIT);
    const ready = () => until(t.tx, 'the Set to be live', () => probe.tick(), (v: any) => v.ready, { within: 20000, every: 300 });

    /* The LED layer sends only changes, so the tap is read as a running map. */
    const leds = new Map<number, number>();
    const led = async (n: number): Promise<number | undefined> => {
        await t.tx.frames(10);
        for (const e of await hb.dumpMidiOut()) if (e.bytes[1] === 0xB0) leds.set(e.bytes[2], e.bytes[3]);
        return leds.get(n);
    };

    const openPage = async () => {
        await dev.holdCc(CC_SHIFT, () => dev.tap.note(STEP_NOTE_BASE));
        await until(t.tx, 'the Sets page', sets, (s) => s.view === 'sets', WAIT);
    };
    /* The whole move in ONE packet, the way movy-host delivers a fast spin
     * (host/deltas.c sums a tick's detents): a list that read only the sign
     * moved one row per spin, and this is what caught it. */
    const cursorTo = async (row: number) => {
        const d = Math.max(-63, Math.min(63, row - (await sets()).selected));
        if (d !== 0) await t.tx.uiMidi(cc(CC_JOG_TURN, d > 0 ? d : 128 + d));
        await until(t.tx, `the cursor on row ${row}`, sets, (v) => v.selected === row, WAIT);
    };
    const rowOf = async (id: string) => (await lib()).rows.findIndex((r) => r.id === id) + 1;
    const nameOf = async (id: string) => (await lib()).rows.find((r) => r.id === id)?.name;

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);
    await hb.subscribeMidiOut();
    await hb.dumpMidiOut();

    // ── S1/S2: the page, and what its buttons say ───────────────────────────
    await openPage();
    const l0 = await libUntil('the library answer', (l) => l.rows.length > 0);
    const home = l0.cur;
    t.check('opens-on-open-set', 'the page opens on the open Set',
        (await sets()).selected === await rowOf(home), { expected: `row of ${home}`, actual: JSON.stringify(await sets()) });
    /* [NEW] first: Copy and Delete are dim outside the page too, so only a
     * change away from dim and back shows on the tap. */
    await cursorTo(0);
    const onNew = [await led(CC_CAPTURE), await led(CC_COPY), await led(CC_DELETE)];
    t.check('edit-leds-dark-on-new', 'Capture/Copy/Delete are dark on [NEW]', onNew.every((v) => v === OFF),
        { expected: `${OFF},${OFF},${OFF}`, actual: onNew.join(',') });
    await cursorTo(await rowOf(home));
    const onSet = [await led(CC_CAPTURE), await led(CC_COPY), await led(CC_DELETE)];
    t.check('edit-leds-lit', 'and dim on a Set', onSet.every((v) => v === DIM),
        { expected: `${DIM},${DIM},${DIM}`, actual: onSet.join(',') });
    await cursorTo(0);

    // ── S3: [NEW] ───────────────────────────────────────────────────────────
    await dev.tap.jog();
    const l1 = await libUntil('a new Set made and opened', (l) => !!l.made && l.made !== l0.made && l.cur === l.made);
    const made = l1.made;
    await ready();
    t.check('new-is-dated', '[NEW] makes a dated Set and opens it', DATED.test(await nameOf(made) ?? ''),
        { expected: 'YYYY-MM-DD_NN', actual: String(await nameOf(made)) });

    // ── S4-S6: rename through the real keyboard ─────────────────────────────
    await openPage();
    await dev.tap.cc(CC_CAPTURE);
    const kb = await until(t.tx, 'the keyboard', sets, (s) => s.keyboard, WAIT);
    const offered = kb.buffer ?? '';
    t.check('rename-offers-pair', 'a dated Set opens the keyboard on a generated pair', PAIR.test(offered),
        { expected: 'Two Words', actual: JSON.stringify(offered) });
    /* Back is dim before and under the keyboard, so it sends nothing: unsent
     * is "still dim", and only an OFF would be the failure. */
    const under = [await led(CC_COPY), await led(CC_CAPTURE), (await led(CC_BACK)) ?? DIM];
    t.check('keyboard-leds', 'under the keyboard only Back is lit', under.join() === `${OFF},${OFF},${DIM}`,
        { expected: `${OFF},${OFF},${DIM}`, actual: under.join(',') });
    /* OK is the keyboard's last item and the wheel clamps there. */
    await t.tx.uiMidi(cc(CC_JOG_TURN, 63));
    await t.tx.frames(10);
    await dev.tap.jog();
    await libUntil('the rename', (l) => l.rows.find((r) => r.id === made)?.name === offered);
    const after = await sets();
    t.check('rename-applied', 'OK renames the Set', (await nameOf(made)) === offered && !after.keyboard && after.view === 'sets',
        { expected: `${offered}, keyboard closed, still on the page`, actual: `${await nameOf(made)} ${JSON.stringify(after)}` });

    // ── S7: a named Set keeps its name; Back cancels ────────────────────────
    await dev.tap.cc(CC_CAPTURE);
    const kb2 = await until(t.tx, 'the keyboard again', sets, (s) => s.keyboard, WAIT);
    await dev.tap.cc(CC_BACK);
    const back = await until(t.tx, 'the keyboard to close', sets, (s) => !s.keyboard, WAIT);
    t.check('rename-cancel', 'a named Set opens on its own name, and Back changes nothing',
        kb2.buffer === offered && (await nameOf(made)) === offered && back.view === 'sets',
        { expected: `buffer ${offered}, name kept, page up`, actual: `${kb2.buffer} / ${await nameOf(made)} / ${back.view}` });

    // ── S8: Copy ────────────────────────────────────────────────────────────
    await dev.tap.cc(CC_COPY);
    const l2 = await libUntil('the copy', (l) => !!l.made && l.made !== made);
    const copy = l2.made;
    const copyRow = await rowOf(copy);
    const onCopy = await until(t.tx, 'the cursor on the copy', sets, (s) => s.selected === copyRow, WAIT).catch(() => null);
    t.check('copy', 'Copy makes "<name> Copy" and the cursor follows it',
        (await nameOf(copy)) === `${offered} Copy` && !!onCopy,
        { expected: `${offered} Copy, cursor on it`, actual: `${await nameOf(copy)} ${JSON.stringify(await sets())}` });

    // ── S9: delete the open Set ─────────────────────────────────────────────
    await cursorTo(await rowOf(made));
    await dev.tap.cc(CC_DELETE);
    await until(t.tx, 'the delete confirm', sets, (s) => s.confirming, WAIT);
    const armed = await led(CC_CAPTURE);
    await dev.tap.jog();
    const l3 = await libUntil('the open Set left, then deleted', (l) => l.cur !== made && !l.rows.some((r) => r.id === made));
    await ready();
    t.check('delete-open-set', 'deleting the open Set opens its neighbour, then deletes it',
        l3.cur === copy && armed === OFF,
        { expected: `open ${copy}, capture dark while armed`, actual: `open ${l3.cur}, capture ${armed}` });

    // ── S10: it all survives a close and reopen ─────────────────────────────
    await dev.reopen(probe);
    await openPage();
    const l4 = await libUntil('the library after a reopen', (l) => l.rows.length > 0);
    t.check('survives-reopen', 'after a reopen: the copy is open, named, and the deleted Set is gone',
        l4.cur === copy && l4.rows.find((r) => r.id === copy)?.name === `${offered} Copy` && !l4.rows.some((r) => r.id === made),
        { expected: `cur ${copy}, "${offered} Copy", no ${made}`, actual: JSON.stringify({ cur: l4.cur, rows: l4.rows.filter((r) => r.id === copy || r.id === made) }) });

    // ── S11: back to the fixture, and leave nothing behind ──────────────────
    await cursorTo(await rowOf(home));
    await dev.tap.jog();
    await libUntil('the fixture Set reopened', (l) => l.cur === home);
    await ready();
    await openPage();
    await cursorTo(await rowOf(copy));
    await dev.tap.cc(CC_DELETE);
    await until(t.tx, 'the delete confirm', sets, (s) => s.confirming, WAIT);
    await dev.tap.jog();
    const l5 = await libUntil('the copy deleted', (l) => !l.rows.some((r) => r.id === copy));
    t.check('cleanup', 'the copy is deleted and the fixture Set is open', l5.cur === home,
        { expected: home, actual: l5.cur });
    await dev.tap.cc(CC_BACK);
}, { needs: 'testbus' });
