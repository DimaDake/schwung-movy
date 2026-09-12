/* Migrated from scripts/test-sends.sh — a movy send FX bus actually carries
 * audio.
 *
 * The one claim no host build can reach. browser-test/logic/mixer.mjs proves the
 * routing and send_bus.rs proves the arithmetic, but neither can load a real
 * audio FX into a real chain host and watch a track's signal come out the other
 * side — a host build cannot load a chain at all.
 *
 * Two failures with the same symptom are separated on purpose:
 *
 *   in=0   — no track fed the bus (a mix/tap bug)
 *   out=0  — the bus was fed and the FX produced silence (a load/process bug)
 *
 * `sndlog` is what makes both visible: the remote-UI socket a device test drives
 * can WRITE engine params but cannot read them, so the diagnostic is a
 * write-to-read log line, read out of band over SSH. `in` is the engine's own
 * per-block input peak (send_bus.rs `accumulate`, zeroed by `take_plan` the
 * moment a track stops feeding) — never a total this suite accumulates, which is
 * what would let a bus that fed once and then stalled still read as fed.
 *
 * WHERE THE TIME WENT. The bash suite spent ~19 s of `sleep`, one in front of
 * nearly every read, because none of these facts has a ViewModel behind it. Each
 * is now a wait on the thing it stood in for:
 *   - a `sndlog` poke is waited for by counting its OWN line (the trick
 *     fixture.ts's `chloaded` uses, for the same write-to-read reason);
 *   - a mix write is waited for through the engine's `ch<N>:mix` read-back.
 *     `parse_mix` is all-or-nothing — a refused width leaves the previous value
 *     — so "changed" means "landed", and that is what the bash sleeps covered.
 *
 * WHAT CHANGED BEYOND THE MECHANICS:
 *   - S11 now asserts what its label claims. The bash condition was
 *     `LAST:mod=freeverb`, which the module load it had just requested satisfies
 *     on its own, so the claim in the label — that a mix as wide as the engine's
 *     bus count is ACCEPTED, and puts its level on the LAST bus — was never read
 *     back. It is now, off the engine's mixer.
 *   - every bus is emptied AND the track's sends are zeroed on the way out. The
 *     bash cleared only the modules, leaving a live send feeding a bus with
 *     nothing in it for every suite that ran afterwards.
 *
 * Covers:
 *   S1  the engine answers `sndlog` at all
 *   S2  bus 0 starts with no module
 *   S3  and nothing has been fed to it
 *   S4  the bus reports the module it was given
 *   S5  the track's audio reached the bus
 *   S6  the FX pass ran
 *   S7  and audio came out of it
 *   S8  the CPU page sees a module in the bus
 *   S9  and charges it for what its FX pass cost
 *   S10 nothing reaches a bus the track is not sending to
 *   S11 the engine accepted a mix as wide as it has buses
 *   S12 the last bus was fed
 *   S13 and audio came out of it
 *   S14 and bus 0 was left alone
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/sends.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Cheap, always installed, and audibly wet — measure-send-cost.sh sweeps it too.
 * Not a fixture module: the fixture is about the twelve TRACK chains, and a send
 * bus is not a track. */
const SEND_FX = 'freeverb';

/* The only track the fixture seeds with a synth (a drum module sits on track 1);
 * every other track is empty, so a send from one would measure silence and
 * report it as a routing bug. Track 0 is movy chain 0. */
const TRACK = 0;

/* Frames of device work. A frame is the shim's SPI period (~2.9 ms), so these
 * are quantities of device work and not wall clocks. */
/* After the open. `open()` waits for movy's own set-ready line, which the chain
 * set is issued ahead of but SERVICED after — loads are queued one per audio
 * callback and the send buses are last in the document. A bus left holding a
 * previous suite's module would fail S2 for a reason that is not movy's. */
const RESTORE = 600;
/* After a note-on. The FX has to run a few blocks with the note sounding for
 * `in`, `out` and the cost meter all to carry a number — the bash suite's
 * `sleep 2`, sized off a run that measured in=10721 / out=19226. */
const SETTLE = 400;

const SENDS = 'sends: ';
/* `cpulog`'s line. Anchored on a field it always carries, so the wait cannot be
 * satisfied by some other line that happens to contain "cpu: ". */
const CPU = 'cpu: chcost=';

/* One bus's group out of the report. The leading `(?:^| )` keeps bus 0 from
 * matching inside bus 10 — the engines have three buses today, and a check that
 * silently read the wrong one would go on passing. */
type BusGroup = { in: number; out: number; blocks: number };

const busAt = (line: string, bus: number): BusGroup | null => {
    const m = line.match(new RegExp(`(?:^| )${bus}:in=(\\d+),out=(\\d+),blocks=(\\d+)`));
    return m ? { in: Number(m[1]), out: Number(m[2]), blocks: Number(m[3]) } : null;
};

const moduleAt = (line: string, bus: number): string =>
    (line.match(new RegExp(`(?:^| )${bus}:mod=(\\S+)`)) ?? [])[1] ?? '';

/* How many buses the ENGINE has, counted off its own report — one `N:in=…`
 * group each. The bash suite read it from the UI's `dist/esm/chain/config.js`
 * so that it would widen with the engine rather than test a bus count it was
 * written against, and that intent is what this keeps. Where it came from had
 * to move: this suite drives the engine directly and asserts on the engine's
 * numbers, and a top-level import of a build artifact would take the WHOLE
 * scenario runner down on a tree where `npm run test:device` (which does not
 * run `build:browser`) is the first thing anyone runs. */
const busCount = (line: string): number =>
    (line.match(/(?:^| )\d+:in=\d+,out=\d+,blocks=\d+/g) ?? []).length;

/* The `sndcost=` field: one `mean/peak` per bus, `-` for a bus with no module.
 * `-` and `0/0` are different answers — "there is no module here" against "the
 * module here is costing nothing right now" — which is the pair S8/S9 split. */
const sendCost = (line: string): string[] =>
    ((line.match(/ sndcost=(\S+)/) ?? [])[1] ?? '').split(',').filter(Boolean);

/* The engine's `mix_csv` pack: 4 dp, and trailing zero sends dropped down to the
 * two-send floor. Derived from what was written rather than copied out of a log,
 * so the expectation cannot drift from the write. Mirrors the engine's `mix_csv`
 * and src/mixer/mix-io.ts's `packMixValue`, which agree with each other. */
function packMix(gain: number, pan: number, muted: 0 | 1, send: number[]): string {
    let n = send.length;
    while (n > 2 && (send[n - 1] ?? 0) === 0) n--;
    const out = [gain.toFixed(4), pan.toFixed(4), String(muted)];
    for (let i = 0; i < n; i++) out.push((send[i] ?? 0).toFixed(4));
    return out.join(',');
}

/* Every bus at zero except `live`, which is at full. -1 means "none live". */
const sendArray = (buses: number, live: number): number[] =>
    Array.from({ length: buses }, (_, b) => (b === live ? 1 : 0));

/* Unity gain, centred, unmuted. */
const unity = (buses: number, live: number) => packMix(1, 0, 0, sendArray(buses, live));

const group = (b: BusGroup | null): string =>
    b ? `in=${b.in},out=${b.out},blocks=${b.blocks}` : '<no bus group>';

scenario('sends', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* A movy ENGINE param write, over the WebSocket the remote UI exposes.
     *
     * NOT the test bus, and that is forced rather than preferred: testd's
     * SET_PARAM splits the wire line on its first space and treats a
     * whitespace-only remainder as a MISSING value, so the EMPTY value that
     * emptying a bus consists of is unreachable through it. The bash suite wrote
     * every one of these this way; keeping one writer keeps the load and the
     * clear on the same path. */
    const ep = async (key: string, value: string): Promise<void> => {
        await run('node', [join(MOVY, 'scripts', 'engine-param.mjs'),
                           'set', key, value, t.host], { maxBuffer: 8 * 1024 * 1024 });
    };

    const param = async (key: string): Promise<string> => {
        try { return (await dev.param.get(key)).trim(); } catch { return ''; }
    };

    /* Wait for an engine param to satisfy `ok`, at PROBE_GAP spacing: the
     * overtake_dsp param slot is shared with movy's own writes, so a tight poll
     * makes the answer vanish. Returns the last value seen either way — the
     * checks say what is missing, not the wait. */
    const paramUntil = async (key: string, ok: (v: string) => boolean,
                              what: string, within = 1500): Promise<string> => {
        let last = '';
        try {
            last = await until(t.bus, what, () => param(key), ok,
                               { within, every: 150 });
        } catch (e: any) { last = typeof e?.last === 'string' ? e.last : ''; }
        return last;
    };

    /* One `sndlog` poke, and the line that poke produced. It is write-to-read:
     * the poke makes the engine log the report ONCE, so this waits for a line
     * COUNT to grow rather than taking the last one — an earlier line describes
     * the buses from before whatever the caller just did. */
    const report = async (what: string): Promise<string> => {
        const before = (await dev.logLines(SENDS)).length;
        await ep('sndlog', '1');
        try {
            const ls = await until(t.bus, what, () => dev.logLines(SENDS),
                                   (v) => v.length > before,
                                   { within: 1500, every: 100 });
            return ls[ls.length - 1];
        } catch { return ''; }
    };

    /* Poke until the report satisfies `ok`. A module load is queued one per
     * audio callback, so "has it landed yet" is a condition and not a duration —
     * the bash suite covered it with `sleep 2`. `ok` here is deliberately weaker
     * than the check that reads the result: S4 is about the module's IDENTITY,
     * which a "is anything there" wait cannot satisfy. */
    const reportUntil = async (ok: (l: string) => boolean, what: string): Promise<string> => {
        try {
            return await until(t.bus, what, () => report(what), ok,
                               { within: 1800, every: 100 });
        } catch { return report(what); }
    };

    const cpuReport = async (what: string): Promise<string> => {
        const before = (await dev.logLines(CPU)).length;
        await ep('cpulog', '1');
        try {
            const ls = await until(t.bus, what, () => dev.logLines(CPU),
                                   (v) => v.length > before,
                                   { within: 1500, every: 100 });
            return ls[ls.length - 1];
        } catch { return ''; }
    };

    /* Write a mix and wait for the engine to hold a DIFFERENT one.
     *
     * The precondition is deliberately "changed", not "changed to what I wrote":
     * S10/S11 are about the value that LANDED, and waiting for that value would
     * make them unfalsifiable. It is still a sound precondition rather than a
     * guess — `parse_mix` is all-or-nothing, so a refused value leaves the
     * previous one and "changed" can only mean "landed". */
    const setMix = async (value: string, what: string): Promise<string> => {
        const before = await param(`overtake_dsp:ch${TRACK}:mix`);
        await ep(`ch${TRACK}:mix`, value);
        return paramUntil(`overtake_dsp:ch${TRACK}:mix`,
                          (v) => v !== '' && v !== before, what);
    };

    /* The note the bus is fed from. Held across the measurement — a bus fed
     * silence has nothing to send, and an FX can idle out on it. */
    const noteOn  = () => ep(`ch${TRACK}:midi`, '144.60.100');
    const noteOff = () => ep(`ch${TRACK}:midi`, '128.60.0');

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await t.bus.frames(RESTORE);

    // ── S1–S3: a bus with no module and no sender ────────────────────────────
    const base = await report('the first sndlog answer');
    t.note('baseReport', base);
    /* Read off the report rather than written down — see `busCount`. Every arm
     * below is built from it, so a build with a fourth bus is exercised by the
     * same three checks instead of silently skipping it. */
    const BUSES = busCount(base);
    t.note('buses', BUSES);

    t.check('sndlog-answers', 'the engine answers sndlog at all', base !== '',
        { expected: 'a `sends: …` line',
          actual: base || 'no `sends:` line — the diagnostic never ran' });

    t.check('bus-empty', 'bus 0 starts with no module', moduleAt(base, 0) === '-',
        { expected: '0:mod=-',
          actual: base !== '' ? `0:mod=${moduleAt(base, 0) || '<no 0:mod field>'}`
                              : 'no report line' });

    const base0 = busAt(base, 0);
    t.check('bus-unfed', 'and nothing has been fed to it',
        base0 !== null && base0.in === 0 && base0.out === 0,
        { expected: '0:in=0,out=0',
          actual: base !== '' ? `0:${group(base0)}` : 'no report line' });

    // ── S4: loading the FX into send 1 ───────────────────────────────────────
    /* `0:mod` reading as anything but `-` is the load LANDING, not the load
     * being correct — so S4 can still fail on the id, and does if the engine is
     * given one it cannot resolve. */
    await ep('snd0:module', SEND_FX);
    const loaded = await reportUntil((l) => {
        const m = moduleAt(l, 0);
        return m !== '' && m !== '-';
    }, 'bus 0 to report a module');
    t.note('loadedReport', loaded);

    t.check('module-reported', 'the bus reports the module it was given',
        moduleAt(loaded, 0) === SEND_FX,
        { expected: `0:mod=${SEND_FX}`,
          actual: loaded !== '' ? `0:mod=${moduleAt(loaded, 0) || '<no 0:mod field>'}`
                                : 'no report line' });

    // ── S5–S9: feeding it from track 0 ───────────────────────────────────────
    /* Unity gain, centred, unmuted, send 1 at full. */
    const fedMix  = unity(BUSES, 0);
    const fedHeld = await setMix(fedMix, 'the engine to take the fed mix');
    t.note('fedMix', { wrote: fedMix, held: fedHeld });

    await noteOn();
    await t.bus.frames(SETTLE);
    const fed = await report('the fed-bus report');
    /* The CPU page's own field, read while the note is still HELD: `sndcost` is
     * what `service_send_load` sets `send_loaded` for, a path a host build never
     * reaches, so "the page sees a send region at all" is only ever provable
     * here. The peak survives the note stopping; the mean decays once the bus
     * stops running. */
    const cpu = await cpuReport('the cpulog answer');
    await noteOff();
    t.note('fedReport', fed);
    t.note('cpuReport', cpu);

    const fed0 = busAt(fed, 0);
    const fedActual = fed !== '' ? `0:${group(fed0)}` : 'no report line';
    t.check('track-reached-bus', "the track's audio reached the bus",
        (fed0?.in ?? 0) > 0,
        { expected: '0:in>0', actual: fedActual });
    t.check('fx-ran', 'the FX pass ran', (fed0?.blocks ?? 0) > 0,
        { expected: '0:blocks>0', actual: fedActual });
    t.check('bus-output', 'and audio came out of it', (fed0?.out ?? 0) > 0,
        { expected: '0:out>0', actual: fedActual });

    const cost = sendCost(cpu);
    const b0 = cost[0] ?? '';
    t.check('cpu-sees-module', 'the CPU page sees a module in the bus',
        b0 !== '' && b0 !== '-',
        { expected: 'a bus-0 `sndcost=` entry that is not `-`',
          actual: cpu !== '' ? `sndcost=${b0 || '<no bus 0 entry>'}`
                             : 'no `cpu:` line' });
    const b0peak = Number(b0.split('/')[1] ?? '');
    t.check('cpu-charges-fx', 'and charges it for what its FX pass cost',
        Number.isFinite(b0peak) && b0peak > 0,
        { expected: 'a bus-0 peak > 0 us',
          actual: cpu !== '' ? `bus 0 held peak ${b0.split('/')[1] ?? 'none'} us`
                             : 'no `cpu:` line' });

    // ── S10: a track at zero send feeds nothing ──────────────────────────────
    /* The zero-cost path, on the device rather than in a unit test: the same
     * note, the same loaded FX, only the send level down. */
    const zeroMix  = unity(BUSES, -1);
    const zeroHeld = await setMix(zeroMix, 'the engine to take the zero send');
    t.note('zeroMix', { wrote: zeroMix, held: zeroHeld });

    await noteOn();
    await t.bus.frames(SETTLE);
    const zero = await report('the zero-send report');
    await noteOff();
    t.note('zeroReport', zero);

    const zero0 = busAt(zero, 0);
    t.check('zero-send-silent', 'nothing reaches a bus the track is not sending to',
        zero0 !== null && zero0.in === 0,
        { expected: '0:in=0',
          actual: zero !== '' ? `0:${group(zero0)}` : 'no report line' });

    // ── S11–S14: the last bus is fed by its own field, not another bus's ─────
    /* The widening claim, and the one a unit test cannot make: a mix as wide as
     * the engine has buses has to land on bus LAST and NOWHERE ELSE. An
     * off-by-one in the parse or in the tap would feed bus 0 or 1 instead, and
     * every "a send carries audio" check above would still pass while the third
     * knob drove the wrong reverb.
     *
     * Bus 0 still holds its module from the arms above, with its send at zero —
     * so it is a live control, not an empty slot that could not light up anyway.
     */
    const LAST = BUSES - 1;
    await ep(`snd${LAST}:module`, SEND_FX);
    const lastLoaded = await reportUntil((l) => {
        const m = moduleAt(l, LAST);
        return m !== '' && m !== '-';
    }, `bus ${LAST} to report a module`);
    t.note('lastBusModule', moduleAt(lastLoaded, LAST));

    const wideMix  = unity(BUSES, LAST);
    const wideHeld = await setMix(wideMix, 'the engine to take the widened mix');
    t.note('wideMix', { wrote: wideMix, held: wideHeld });

    await noteOn();
    await t.bus.frames(SETTLE);
    const wide = await report('the widened-mix report');
    await noteOff();
    t.note('wideReport', wide);

    /* The read-back is taken here, after the arm, and this is the half the bash
     * suite never made: its condition was `LAST:mod=freeverb`, satisfied by the
     * load it had just requested, so a mix the engine REFUSED — leaving bus 0's
     * zero-send value in place — would have passed the check whose label claims
     * the width was accepted. */
    const wideRead = await param(`overtake_dsp:ch${TRACK}:mix`);
    t.note('wideMixReadback', wideRead);
    t.check('wide-mix-accepted', 'the engine accepted a mix as wide as it has buses',
        wideRead === wideMix && moduleAt(wide, LAST) === SEND_FX,
        { expected: `ch${TRACK}:mix reads back ${wideMix} (${BUSES} send fields) `
                    + `and bus ${LAST} reports ${SEND_FX}`,
          actual: wideRead !== wideMix
                ? `the engine holds ${wideRead || '<nothing>'} after being written ${wideMix}`
                  + ' — the widened field was refused, so every check below is about the wrong bus'
                : wide !== '' ? `ch${TRACK}:mix holds ${wideRead}, but bus ${LAST} reports `
                                + `${moduleAt(wide, LAST) || '<no LAST:mod field>'}`
                              : 'no report line' });

    const lg = busAt(wide, LAST);
    t.check('last-bus-fed', 'the last bus was fed', (lg?.in ?? 0) > 0,
        { expected: `${LAST}:in>0`,
          actual: wide !== '' ? `${LAST}:${group(lg)} — the widened field never reached bus ${LAST}`
                              : 'no report line' });
    t.check('last-bus-output', 'and audio came out of it', (lg?.out ?? 0) > 0,
        { expected: `${LAST}:out>0`,
          actual: wide !== '' ? `${LAST}:${group(lg)}` : 'no report line' });

    const other = busAt(wide, 0);
    t.check('bus0-untouched', 'and bus 0 was left alone',
        other !== null && other.in === 0,
        { expected: '0:in=0',
          actual: wide !== '' ? `0:${group(other)} — the send landed on the wrong bus`
                              : 'no report line' });

    /* Leave the device as the suite found it.
     *
     * TWO things, not one. The bash suite emptied the buses but left the track
     * at `1.0,0.0,0,0.0,0.0,1.0`, so every suite that ran after it had track 0
     * feeding a bus with nothing in it: the tap still ran, the buffer still
     * accumulated, and nothing ever consumed it. Registered rather than run
     * inline so it happens on a throw too — which is exactly when the device is
     * most likely to be left dirty. */
    t.need.register(async () => {
        for (let b = 0; b < BUSES; b++) await ep(`snd${b}:module`, '');
        await ep(`ch${TRACK}:mix`, unity(BUSES, -1));
    });
});
