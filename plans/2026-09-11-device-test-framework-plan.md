# Device Test Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace movy's 14 bash device suites with a TypeScript scenario framework that synchronizes on device frames instead of sleeps and asserts on movy's own state instead of log greps.

**Architecture:** One Node process holds one persistent TCP connection to `schwung-testd` (an on-device test-bus daemon that already ships with schwung and is already installed on the device). Gestures become single MIDI packets; waits become `WAIT_FRAME` or condition polls; assertions read movy's ViewModel through a new generic schwung probe hook, falling back to a frame-bounded log stream when that hook is absent.

**Tech Stack:** TypeScript (Node 20+, ESM, no new runtime deps), C (schwung test daemon + shadow_ui builtin), bash (only for the device-side daemon launcher).

**Spec:** `movy/plans/2026-09-11-device-test-framework-design.md` — read it first; this plan argues from it.

## Global Constraints

- **File size:** hard limit 200 lines per file in `src/`; `test-device/` follows the looser `browser-test/` ceiling of ~600 lines. Target 50–100.
- **No wall-clock sleeps anywhere in `test-device/`.** No `setTimeout` used as a delay, no `sleep`. Timeouts are expressed as *frame budgets*. The one permitted exception is the TCP socket connect timeout in `bus.ts`.
- **No file under `movy/test-device/` may reference a path outside the movy repo.** No `../schwung-midi-inject-ui.py`, no `../schwung/`.
- **schwung is a reference-only checkout.** Never edit `/Users/dake/git/cld/schwung`. Schwung changes happen on a fork clone at `/Users/dake/git/cld/schwung-testfw` and ship as an upstream PR framed as a schwung feature — never as a movy patch, and the PR body must not mention movy as the motivation.
- **Verbs arrange, gestures assert.** Any behaviour under test is triggered by injected MIDI. The probe's arrange-verbs may set up state but may never be what triggers the thing being checked.
- **Prove teeth.** A new assertion is only done when you have removed the code it guards, watched it fail, and put the code back.
- **Device flakiness rule (from `CLAUDE.md`):** run a device suite once. If it fails, check whether it points at your change; otherwise report and move on. Do not bisect or re-run device failures.
- **Commit style:** `git add <specific files>`, never `git add -A`. Co-author trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Device address:** `ableton@move.local`. Probe reachability with ssh, never ping (ICMP is blocked).
- **testd protocol:** line-based ASCII, `\n`-terminated, one command per line, replies begin `OK` or `ERR`. `DUMP` is multi-line: `OK count=<N> dropped=<D>`, then `EV <frame_hex> <pkt_hex>` × N, then `END`.
- **USB-MIDI packet:** 4 bytes as 8 hex chars. Byte 0 = `(cable << 4) | CIN`. CIN `0x9` note-on, `0x8` note-off, `0xB` CC. Cable 0 for input injection.
- **Movy CC map** (`shared/constants.mjs`): jog-click 3, jog-turn 14, Back 51, Play 85, Rec 86, knobs 71–78, tracks 40–43. Step buttons are notes 16–31; pads are notes 68–99.

---

### Task 1: Spike — can `dsp.so` hot-swap without a stack restart?

**Files:**
- Create: `movy/plans/2026-09-11-dsp-hotswap-findings.md`
- Modify (only if the spike succeeds): `movy/CLAUDE.md` (the "A redeployed `dsp.so` does NOT hot-reload" paragraph)

**Interfaces:**
- Consumes: nothing.
- Produces: a documented yes/no that Task 7's `dev.swapEngine()` depends on. If NO, `dev.swapEngine()` is implemented as close → mv → `RESTART_MOVE` → open instead of close → mv → open.

**Why this is first:** `movy/CLAUDE.md` states a redeployed `dsp.so` cannot hot-reload because "glibc returns the library already loaded under that path for as long as MoveOriginal lives". The schwung source contradicts this — `schwung/src/schwung_shim.c` retires the overtake module and the worker calls `dlclose(overtake_free_handle)` (around line 1884). If the mapping really drops, every engine build in this project stops costing a ~10 s stack restart.

- [ ] **Step 1: Record the running engine version**

```bash
cd /Users/dake/git/cld/movy
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'
grep -n 'ENGINE_VERSION' engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
```

Note the current value. Expected: the same string in both files (`build-dsp.sh` enforces it).

- [ ] **Step 2: Build a distinguishable engine**

Bump `ENGINE_VERSION` in BOTH files to a value ending `-hotswap1`, then:

```bash
cd /Users/dake/git/cld/movy && ./scripts/build-dsp.sh
```

Expected: `dist/dsp.so` rebuilt, no version-mismatch error. (`cargo` is not on PATH — use `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin` if the script complains.)

- [ ] **Step 3: Close movy and confirm the module was actually freed**

```bash
ssh ableton@move.local '> /data/UserData/schwung/debug.log'
# Exit movy: Back x3 via the existing inject helper
python3 ../schwung-midi-inject-ui.py move.local cc 51 127
python3 ../schwung-midi-inject-ui.py move.local cc 51 0
# (repeat twice more, then:)
ssh ableton@move.local 'grep -c "retired module freed" /data/UserData/schwung/debug.log'
```

Expected: `1` or more. **If it is `0`, the spike's premise fails** — the module was not freed (check for `snapshot worker wedged — leaking instance + handle`, the branch in `schwung_shim.c` that deliberately skips the `dlclose`). Record that and answer NO.

- [ ] **Step 4: Deploy the new .so with a fresh inode, without restarting**

```bash
cd /Users/dake/git/cld/movy && ./scripts/deploy.sh --no-restart move.local
```

Expected: it says loudly that the old engine is still running. That warning is exactly what this spike is testing.

- [ ] **Step 5: Reopen movy and read the version back**

```bash
ssh ableton@move.local 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"'
ssh ableton@move.local 'grep "ENGINE\|ping" /data/UserData/schwung/debug.log | tail -20'
```

Expected if YES: the log shows the `-hotswap1` version. Expected if NO: the old version, or the version gate looping (`re-issuing the DSP load`).

- [ ] **Step 6: Write the findings**

Create `movy/plans/2026-09-11-dsp-hotswap-findings.md` with: the answer, the exact log evidence for it, and — if NO — which of these it was: the `snap_wait_idle` wedge branch leaking instead of closing; another `dlopen` of the same path holding a refcount (check `ssh ableton@move.local 'grep dsp.so /proc/$(pidof MoveOriginal)/maps'` after the close); or `RTLD_NODELETE`.

- [ ] **Step 7: Correct the docs if the answer is YES**

Replace the "A redeployed `dsp.so` does NOT hot-reload" paragraph in `movy/CLAUDE.md` with the measured behaviour and the exact sequence that works. Leave it untouched if the answer is NO.

- [ ] **Step 8: Restore ENGINE_VERSION and commit**

Revert the `-hotswap1` suffix in both files, rebuild, deploy normally.

```bash
git add plans/2026-09-11-dsp-hotswap-findings.md CLAUDE.md
git commit -m "spike: measure whether dsp.so hot-swaps without a stack restart

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `bus.ts` — the testd protocol client

**Files:**
- Create: `movy/test-device/bus.ts`
- Create: `movy/test-device/daemon.ts`
- Create: `movy/test-device/midi.ts`
- Test: `movy/test-device/selftest/bus.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class Bus` with `connect(): Promise<void>`, `send(line: string): Promise<string>`, `sendMulti(line: string): Promise<string[]>`, `close(): void`
  - `ping(): Promise<string>`, `state(): Promise<Record<string, number>>`, `frames(n: number): Promise<number>`, `injectMidi(pkt: number[]): Promise<void>`, `getParam(key: string): Promise<string>`, `setParam(key: string, v: string): Promise<void>`, `padLeds(): Promise<Uint8Array>`, `openTool(id: string): Promise<void>`, `subscribe(ch: string): Promise<void>`, `dump(ch: string): Promise<BusEvent[]>`, `unsubscribe(ch: string): Promise<void>`, `restartMove(): Promise<void>`
  - `type BusEvent = { frame: number; bytes: number[] }`
  - `ensureDaemon(host: string): Promise<{ startedByUs: boolean }>` and `stopDaemon(host: string): Promise<void>` from `daemon.ts`
  - `cc(n, v)`, `noteOn(n, v)`, `noteOff(n)` from `midi.ts`, each returning a 4-byte packet array

- [ ] **Step 1: Write the failing selftest**

Create `movy/test-device/selftest/bus.mjs`. This is a *device* selftest — it needs a real Move. It skips cleanly when unreachable, which is the repo's existing convention.

```js
/* Selftest for bus.ts against a real device. Skips when the Move is unreachable. */
import { Bus } from '../../dist/esm/test-device/bus.js';
import { ensureDaemon, stopDaemon } from '../../dist/esm/test-device/daemon.js';
import { cc } from '../../dist/esm/test-device/midi.js';

const HOST = process.env.HOST || 'move.local';
let fails = 0;
const ok = (label, cond, detail = '') => {
    if (cond) { console.log('✓ ' + label); }
    else { console.log('✗ ' + label + (detail ? '  ' + detail : '')); fails++; }
};

const { startedByUs } = await ensureDaemon(HOST);
const bus = new Bus(HOST);
await bus.connect();

const reply = await bus.ping();
ok('PING answers with a version', reply.startsWith('schwung-testd '), reply);

const a = await bus.frames(1);
const b = await bus.frames(2);
ok('WAIT_FRAME advances the counter', ((b - a) & 0xFFFFFFFF) >= 2, `a=${a} b=${b}`);

const st = await bus.state();
ok('STATE parses to numbers', typeof st.shim_counter === 'number', JSON.stringify(st));

const leds = await bus.padLeds();
ok('SNAPSHOT_PAD_LEDS returns 32 bytes', leds.length === 32, String(leds.length));

await bus.injectMidi(cc(3, 0));   // a harmless jog-click release
ok('INJECT_MIDI is accepted', true);

bus.close();
if (startedByUs) await stopDaemon(HOST);
console.log(fails === 0 ? 'BUS SELFTEST PASSED' : `${fails} BUS CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/dake/git/cld/movy && node test-device/selftest/bus.mjs
```

Expected: FAIL — `Cannot find module '.../dist/esm/test-device/bus.js'`.

- [ ] **Step 3: Write `midi.ts`**

```ts
/* USB-MIDI packets, the wire format schwung-testd's INJECT_MIDI takes.
 * Byte 0 is (cable << 4) | CIN; cable 0 is what the device treats as input. */
export type Packet = [number, number, number, number];

export const cc      = (n: number, v: number): Packet => [0x0b, 0xb0, n, v];
export const noteOn  = (n: number, v = 100):  Packet => [0x09, 0x90, n, v];
export const noteOff = (n: number):           Packet => [0x08, 0x80, n, 0];

export const hex = (p: Packet): string =>
    p.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
```

- [ ] **Step 4: Write `daemon.ts`**

```ts
/* schwung-testd is opt-in: it ships with schwung and is installed, but nothing
 * starts it. One ssh at run start is cheaper than an ssh -L tunnel process we
 * would then have to supervise, so bind it on all interfaces and connect to
 * move.local directly. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BIN = '/data/UserData/schwung/bin/schwung-testd';

export async function ensureDaemon(host: string): Promise<{ startedByUs: boolean }> {
    const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', `ableton@${host}`,
        `pgrep -f schwung-testd >/dev/null && echo running || ` +
        `(SCHWUNG_TEST_BIND=0.0.0.0 nohup ${BIN} >/tmp/testd.log 2>&1 & echo started)`]);
    return { startedByUs: stdout.includes('started') };
}

/* Only ever called when ensureDaemon reported `started`: a daemon someone left
 * running by hand is theirs, not ours to kill. */
export async function stopDaemon(host: string): Promise<void> {
    await run('ssh', [`ableton@${host}`, 'pkill -f schwung-testd || true']);
}
```

- [ ] **Step 5: Write `bus.ts`**

```ts
import net from 'node:net';
import { hex, type Packet } from './midi.js';

export type BusEvent = { frame: number; bytes: number[] };

/* One persistent connection for a whole run. The daemon's contract is one
 * client at a time, and its per-connection state (subscriptions) is why this
 * must not reconnect per command. */
export class Bus {
    private sock: net.Socket | null = null;
    private buf = '';
    private queue: Array<{ multi: boolean; resolve: (v: any) => void; reject: (e: Error) => void; lines: string[] }> = [];

    constructor(private host: string, private port = 47777) {}

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const s = net.createConnection({ host: this.host, port: this.port });
            /* The ONLY wall-clock timeout in test-device/: a TCP connect has no
             * frame clock to wait on, because a device that never answers has no
             * frames to count. */
            s.setTimeout(10_000, () => { s.destroy(); reject(new Error(`testd connect timeout ${this.host}:${this.port}`)); });
            s.once('connect', () => { s.setTimeout(0); this.sock = s; resolve(); });
            s.once('error', reject);
            s.on('data', (d) => this.onData(d.toString('utf8')));
        });
    }

    private onData(chunk: string): void {
        this.buf += chunk;
        let nl: number;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, nl).replace(/\r$/, '');
            this.buf = this.buf.slice(nl + 1);
            const w = this.queue[0];
            if (!w) continue;
            if (!w.multi) { this.queue.shift(); this.settle(w, [line]); continue; }
            w.lines.push(line);
            if (line === 'END' || line.startsWith('ERR')) { this.queue.shift(); this.settle(w, w.lines); }
        }
    }

    private settle(w: { resolve: (v: any) => void; reject: (e: Error) => void; multi: boolean }, lines: string[]): void {
        const first = lines[0] ?? '';
        if (first.startsWith('ERR')) { w.reject(new Error(first)); return; }
        w.resolve(w.multi ? lines : first);
    }

    private write(line: string, multi: boolean): Promise<any> {
        if (!this.sock) return Promise.reject(new Error('bus not connected'));
        return new Promise((resolve, reject) => {
            this.queue.push({ multi, resolve, reject, lines: [] });
            this.sock!.write(line + '\n');
        });
    }

    send(line: string): Promise<string> { return this.write(line, false); }
    sendMulti(line: string): Promise<string[]> { return this.write(line, true); }
    close(): void { this.sock?.end(); this.sock = null; }

    async ping(): Promise<string> { return (await this.send('PING')).slice(3); }

    async state(): Promise<Record<string, number>> {
        const r = (await this.send('STATE')).slice(3);
        const out: Record<string, number> = {};
        for (const kv of r.split(/\s+/)) {
            const eq = kv.indexOf('=');
            if (eq > 0) out[kv.slice(0, eq)] = Number(kv.slice(eq + 1));
        }
        return out;
    }

    async frames(n: number): Promise<number> {
        const r = await this.send(`WAIT_FRAME ${n}`);
        return Number(r.replace(/^OK frame=/, ''));
    }

    async injectMidi(p: Packet): Promise<void> { await this.send(`INJECT_MIDI ${hex(p)}`); }
    async getParam(key: string): Promise<string> { return (await this.send(`GET_PARAM ${key}`)).slice(3); }
    async setParam(key: string, v: string): Promise<void> { await this.send(`SET_PARAM ${key} ${v}`); }
    async openTool(id: string): Promise<void> { await this.send(`SET_OPEN_TOOL ${id}`); }
    async restartMove(): Promise<void> { await this.send('RESTART_MOVE'); }
    async subscribe(ch: string): Promise<void> { await this.send(`SUBSCRIBE ${ch}`); }
    async unsubscribe(ch: string): Promise<void> { await this.send(`UNSUBSCRIBE ${ch}`); }

    async padLeds(): Promise<Uint8Array> {
        const r = (await this.send('SNAPSHOT_PAD_LEDS')).slice(3).trim();
        const out = new Uint8Array(r.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(r.slice(i * 2, i * 2 + 2), 16);
        return out;
    }

    async dump(ch: string): Promise<BusEvent[]> {
        const lines = await this.sendMulti(`DUMP ${ch}`);
        const evs: BusEvent[] = [];
        for (const l of lines) {
            if (!l.startsWith('EV ')) continue;
            const [, f, pkt] = l.split(/\s+/);
            const bytes: number[] = [];
            for (let i = 0; i < pkt.length; i += 2) bytes.push(parseInt(pkt.slice(i, i + 2), 16));
            evs.push({ frame: parseInt(f, 16), bytes });
        }
        return evs;
    }
}
```

- [ ] **Step 6: Add `test-device/` to the browser build so the selftest can import it**

In `movy/build/browser.mjs`, add `test-device/bus.ts`, `test-device/daemon.ts` and `test-device/midi.ts` to the entry points alongside the existing ones. Grep for the existing `entryPoints` array to match the shape.

- [ ] **Step 7: Run the selftest against the device**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node test-device/selftest/bus.mjs
```

Expected: `BUS SELFTEST PASSED`, all five checks green. If the Move is unreachable, report DEVICE OFFLINE in CAPS and stop.

- [ ] **Step 8: Prove the selftest has teeth**

Change `frames(n)` to send `WAIT_FRAME 0` instead of `${n}`. Re-run. Expected: the daemon rejects it (`ERR WAIT_FRAME: N must be 1..10000`) and the run fails. Put it back.

- [ ] **Step 9: Commit**

```bash
git add test-device/bus.ts test-device/daemon.ts test-device/midi.ts test-device/selftest/bus.mjs build/browser.mjs
git commit -m "test-device: schwung-testd protocol client

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `wait.ts` — frame-budget synchronization

**Files:**
- Create: `movy/test-device/wait.ts`
- Test: `movy/test-device/selftest/wait.mjs`

**Interfaces:**
- Consumes: `Bus` from Task 2.
- Produces:
  - `class WaitBudgetExceeded extends Error` with fields `{ what: string; frames: number; last: unknown }`
  - `until<T>(bus: Bus, what: string, probe: () => Promise<T>, pred: (v: T) => boolean, opts?: { within?: number; every?: number }): Promise<T>` — default `within` 700 frames (~2 s), `every` 2 frames
  - `untilStable<T>(bus, what, probe, opts?): Promise<T>` — resolves when `probe()` returns the same JSON twice in a row

**Why `until` and not a sleep:** a sleep asserts nothing. `until` fails with the value it was still seeing, which is the diagnostic a sleep can never give.

- [ ] **Step 1: Write the failing selftest**

Create `movy/test-device/selftest/wait.mjs`. This one is host-only — it drives a fake bus, so it needs no device.

```js
import { until, untilStable, WaitBudgetExceeded } from '../../dist/esm/test-device/wait.js';

let fails = 0;
const ok = (label, cond, detail = '') => {
    if (cond) console.log('✓ ' + label);
    else { console.log('✗ ' + label + (detail ? '  ' + detail : '')); fails++; }
};

/* A fake bus whose frames() just counts: no device, no clock. */
const fakeBus = () => { const b = { n: 0, frames: async (k) => (b.n += k) }; return b; };

// resolves as soon as the predicate holds
{
    const bus = fakeBus();
    let calls = 0;
    const v = await until(bus, 'counter', async () => ++calls, (x) => x >= 3);
    ok('until resolves on the predicate', v === 3, `got ${v}`);
    ok('until does not overshoot', calls === 3, `calls=${calls}`);
}

// exhausting the budget throws, and says what it last saw
{
    const bus = fakeBus();
    let err = null;
    try { await until(bus, 'never', async () => 'stuck', () => false, { within: 10, every: 2 }); }
    catch (e) { err = e; }
    ok('budget exhaustion throws WaitBudgetExceeded', err instanceof WaitBudgetExceeded);
    ok('the error names what it waited for', err && /never/.test(err.message), err && err.message);
    ok('the error carries the last value', err && err.last === 'stuck', err && String(err.last));
    ok('the error names the frame budget', err && /10 frames/.test(err.message), err && err.message);
}

// untilStable waits for two identical reads
{
    const bus = fakeBus();
    const seq = [{ a: 1 }, { a: 2 }, { a: 2 }];
    let i = 0;
    const v = await untilStable(bus, 'settling', async () => seq[Math.min(i++, seq.length - 1)]);
    ok('untilStable returns the settled value', v.a === 2, JSON.stringify(v));
}

console.log(fails === 0 ? 'WAIT SELFTEST PASSED' : `${fails} WAIT CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/dake/git/cld/movy && node test-device/selftest/wait.mjs
```

Expected: FAIL — cannot find `dist/esm/test-device/wait.js`.

- [ ] **Step 3: Write `wait.ts`**

```ts
/* Condition waits with a FRAME budget, never a wall clock.
 *
 * A frame is the shim's SPI period (~2.9 ms), so a budget is a quantity of
 * device work rather than of dev-machine time — it does not drift when the
 * device is loaded, and it is the same unit the daemon's WAIT_FRAME speaks. */
type FrameSource = { frames(n: number): Promise<number> };

export class WaitBudgetExceeded extends Error {
    constructor(readonly what: string, readonly frames: number, readonly last: unknown) {
        super(`waited ${frames} frames for ${what}; last saw ${JSON.stringify(last)}`);
        this.name = 'WaitBudgetExceeded';
    }
}

export async function until<T>(
    bus: FrameSource,
    what: string,
    probe: () => Promise<T>,
    pred: (v: T) => boolean,
    opts: { within?: number; every?: number } = {},
): Promise<T> {
    const within = opts.within ?? 700;   // ~2 s of device frames
    const every  = opts.every ?? 2;
    let spent = 0;
    let last: T = await probe();
    if (pred(last)) return last;
    while (spent < within) {
        await bus.frames(every);
        spent += every;
        last = await probe();
        if (pred(last)) return last;
    }
    throw new WaitBudgetExceeded(what, within, last);
}

/* For state with no single predicate — "whatever it becomes, it has stopped
 * becoming it". Two identical consecutive reads. */
export async function untilStable<T>(
    bus: FrameSource,
    what: string,
    probe: () => Promise<T>,
    opts: { within?: number; every?: number } = {},
): Promise<T> {
    let prev = JSON.stringify(await probe());
    return until(bus, what, probe, (v) => {
        const now = JSON.stringify(v);
        const same = now === prev;
        prev = now;
        return same;
    }, opts);
}
```

- [ ] **Step 4: Add `test-device/wait.ts` to `build/browser.mjs` entry points, rebuild, run**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node test-device/selftest/wait.mjs
```

Expected: `WAIT SELFTEST PASSED`, all seven checks.

- [ ] **Step 5: Prove teeth**

Delete the `if (pred(last)) return last;` line that precedes the loop. Re-run. Expected: the "does not overshoot" check fails (`calls=5`, not 3). Restore it.

- [ ] **Step 6: Commit**

```bash
git add test-device/wait.ts test-device/selftest/wait.mjs build/browser.mjs
git commit -m "test-device: frame-budget condition waits

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `runner.ts` + `report.ts` — scenarios, dirty tracking, tiered output

**Files:**
- Create: `movy/test-device/runner.ts`
- Create: `movy/test-device/report.ts`
- Create: `movy/test-device/types.ts`
- Modify: `movy/.gitignore` (add `.test-out/`)
- Modify: `movy/package.json` (add the `test:device` script)
- Test: `movy/test-device/selftest/runner.mjs`

**Interfaces:**
- Consumes: `WaitBudgetExceeded` from Task 3.
- Produces:
  - `type Check = { id: string; label: string; pass: boolean; expected?: string; actual?: string; frame?: number; evidence?: unknown }`
  - `type Ctx = { bus: Bus; host: string; check(id: string, label: string, pass: boolean, detail?: { expected?: string; actual?: string }): void; note(k: string, v: unknown): void; need: NeedApi }`
  - `type NeedApi = { register(undo: () => Promise<void>): void }`
  - `scenario(name: string, fn: (t: Ctx) => Promise<void>): void` and `scenarioEach<T>(values: T[], name: string, fn: (t: Ctx, v: T) => Promise<void>): void`
  - `runAll(opts: { host: string; only?: string; outDir?: string; busFactory?: () => Bus; beforeEach?: () => Promise<void> }): Promise<number>` returning the failure count
  - `writeReport(runDir: string, results: ScenarioResult[]): void` from `report.ts`

- [ ] **Step 1: Write the failing selftest**

Create `movy/test-device/selftest/runner.mjs` — host-only, exercising the runner's bookkeeping with a stub bus.

```js
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { scenario, runAll, _resetForTest } from '../../dist/esm/test-device/runner.js';

let fails = 0;
const ok = (label, cond, detail = '') => {
    if (cond) console.log('✓ ' + label);
    else { console.log('✗ ' + label + (detail ? '  ' + detail : '')); fails++; }
};

const OUT = '.test-out-selftest';
rmSync(OUT, { recursive: true, force: true });
_resetForTest();

const unwound = [];
scenario('green', async (t) => {
    t.need.register(async () => unwound.push('green-undo'));
    t.check('a', 'a holds', true);
});
scenario('red', async (t) => {
    t.need.register(async () => unwound.push('red-undo-1'));
    t.need.register(async () => unwound.push('red-undo-2'));
    t.check('b', 'b holds', false, { expected: '>=3', actual: '1' });
});
scenario('boom', async (t) => {
    t.need.register(async () => unwound.push('boom-undo'));
    throw new Error('scenario exploded');
});

const failures = await runAll({ host: 'fake', outDir: OUT, busFactory: () => ({ frames: async () => 0 }) });

ok('failing checks are counted', failures === 2, `failures=${failures}`);
ok('undo runs on success', unwound.includes('green-undo'));
ok('undo runs on a failed check', unwound.includes('red-undo-1'));
ok('undo runs after a thrown scenario', unwound.includes('boom-undo'));
ok('undo unwinds LIFO',
    unwound.indexOf('red-undo-2') < unwound.indexOf('red-undo-1'),
    unwound.join(','));

ok('a level-1 artifact exists per scenario', existsSync(`${OUT}/red.md`));
const red = readFileSync(`${OUT}/red.md`, 'utf8');
ok('the artifact carries expected vs actual', /expected.*>=3/s.test(red) && /actual.*1/s.test(red), red.slice(0, 200));
ok('a run summary exists', existsSync(`${OUT}/run.json`));

rmSync(OUT, { recursive: true, force: true });
console.log(fails === 0 ? 'RUNNER SELFTEST PASSED' : `${fails} RUNNER CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/dake/git/cld/movy && node test-device/selftest/runner.mjs
```

Expected: FAIL — cannot find `dist/esm/test-device/runner.js`.

- [ ] **Step 3: Write `types.ts`**

```ts
export type Check = {
    id: string;
    label: string;
    pass: boolean;
    expected?: string;
    actual?: string;
    frame?: number;
};

export type ScenarioResult = {
    name: string;
    checks: Check[];
    error?: string;
    seconds: number;
    notes: Record<string, unknown>;
};
```

- [ ] **Step 4: Write `report.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioResult } from './types.js';

/* Three levels, one rule: evidence is captured always, printed never.
 *
 * Level 0 (stdout) is the only thing read by default, so a green sweep must
 * stay a handful of lines and a failure's FIRST line must be diagnostic on its
 * own — an agent that has to re-run the suite to find out what broke is the
 * cost this design exists to remove. */
export function printLevel0(r: ScenarioResult, outDir: string): void {
    const failed = r.checks.filter((c) => !c.pass);
    const n = r.checks.length;
    const mark = failed.length === 0 && !r.error ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const tally = failed.length === 0 ? `${n} checks` : `${n - failed.length}/${n} checks`;
    console.log(`${mark} ${r.name.padEnd(16)} ${tally.padStart(10)}  ${r.seconds.toFixed(1)}s`);
    for (const c of failed) {
        const detail = c.expected !== undefined ? `${c.actual ?? '?'}, want ${c.expected}` : c.label;
        console.log(`  \x1b[31m✗\x1b[0m ${c.id.padEnd(18)} ${detail}     ${outDir}/${r.name}.md#${c.id}`);
    }
    if (r.error) console.log(`  \x1b[31m✗\x1b[0m ${'threw'.padEnd(18)} ${r.error}     ${outDir}/${r.name}.md`);
}

export function writeReport(outDir: string, results: ScenarioResult[]): void {
    mkdirSync(outDir, { recursive: true });
    for (const r of results) {
        const lines: string[] = [`# ${r.name}`, '', `${r.seconds.toFixed(1)}s`, ''];
        if (r.error) lines.push('## threw', '', '```', r.error, '```', '');
        for (const c of r.checks) {
            lines.push(`## ${c.pass ? 'PASS' : 'FAIL'} ${c.id} {#${c.id}}`, '', c.label, '');
            if (c.expected !== undefined) lines.push(`- expected: \`${c.expected}\``);
            if (c.actual !== undefined) lines.push(`- actual: \`${c.actual}\``);
            if (c.frame !== undefined) lines.push(`- frame: ${c.frame}`);
            lines.push('');
        }
        if (Object.keys(r.notes).length) {
            lines.push('## notes', '', '```json', JSON.stringify(r.notes, null, 2), '```', '');
        }
        writeFileSync(join(outDir, `${r.name}.md`), lines.join('\n'));
    }
    writeFileSync(join(outDir, 'run.json'), JSON.stringify(results, null, 2));
    const total = results.reduce((a, r) => a + r.checks.length, 0);
    const failed = results.reduce((a, r) => a + r.checks.filter((c) => !c.pass).length, 0);
    writeFileSync(join(outDir, 'run.md'),
        `# device run\n\n${results.length} scenarios · ${total} checks · ${failed} failed\n`);
}
```

- [ ] **Step 5: Write `runner.ts`**

```ts
import { mkdirSync } from 'node:fs';
import type { Check, ScenarioResult } from './types.js';
import { printLevel0, writeReport } from './report.js';

type Ctx = {
    bus: any;
    host: string;
    check(id: string, label: string, pass: boolean, detail?: { expected?: string; actual?: string }): void;
    note(k: string, v: unknown): void;
    need: { register(undo: () => Promise<void>): void };
};

type Entry = { name: string; fn: (t: Ctx) => Promise<void> };
let registry: Entry[] = [];

export function scenario(name: string, fn: (t: Ctx) => Promise<void>): void {
    registry.push({ name, fn });
}

/* One scenario body run once per value — how a scenario covers all three
 * schwunggrid renderers without being written three times. */
export function scenarioEach<T>(values: T[], name: string, fn: (t: Ctx, v: T) => Promise<void>): void {
    for (const v of values) registry.push({ name: `${name}[${String(v)}]`, fn: (t) => fn(t, v) });
}

export function _resetForTest(): void { registry = []; }

export async function runAll(opts: {
    host: string; only?: string; outDir?: string;
    busFactory?: () => any;
    /* Cheap invariant check run between scenarios (Task 5 passes fixture's).
     * A scenario that corrupts state then costs ONE reseed, not a poisoned
     * sweep — which is what keeps dirty-tracking isolation honest. */
    beforeEach?: () => Promise<void>;
}): Promise<number> {
    const outDir = opts.outDir ?? '.test-out';
    mkdirSync(outDir, { recursive: true });
    const bus = opts.busFactory ? opts.busFactory() : null;
    const results: ScenarioResult[] = [];

    for (const e of registry) {
        if (opts.only && !e.name.startsWith(opts.only)) continue;
        if (opts.beforeEach) await opts.beforeEach();
        const checks: Check[] = [];
        const notes: Record<string, unknown> = {};
        const undos: Array<() => Promise<void>> = [];
        const t0 = Date.now();
        let error: string | undefined;

        const ctx: Ctx = {
            bus,
            host: opts.host,
            check: (id, label, pass, d) => { checks.push({ id, label, pass, ...d }); },
            note: (k, v) => { notes[k] = v; },
            need: { register: (u) => { undos.push(u); } },
        };

        try { await e.fn(ctx); }
        catch (err) { error = err instanceof Error ? (err.stack ?? err.message) : String(err); }

        /* Unwind LIFO whatever happened. A scenario that threw is exactly when
         * the device is most likely to be left dirty, so teardown must not be
         * conditional on success. An undo that itself throws is recorded and
         * the rest still run. */
        for (let i = undos.length - 1; i >= 0; i--) {
            try { await undos[i](); }
            catch (err) { notes[`undo_error_${i}`] = String(err); }
        }

        const r: ScenarioResult = {
            name: e.name, checks, error,
            seconds: (Date.now() - t0) / 1000, notes,
        };
        results.push(r);
        printLevel0(r, outDir);
    }

    writeReport(outDir, results);
    const failed = results.reduce(
        (a, r) => a + r.checks.filter((c) => !c.pass).length + (r.error ? 1 : 0), 0);
    const total = results.reduce((a, r) => a + r.checks.length, 0);
    console.log(`\n${results.length} scenarios · ${total} checks · ${failed} failed   → ${outDir}/run.md`);
    return failed;
}
```

- [ ] **Step 6: Wire the build, gitignore and npm script**

Add `test-device/runner.ts`, `test-device/report.ts`, `test-device/types.ts` to `build/browser.mjs` entry points. Append `.test-out/` to `movy/.gitignore`. In `package.json` scripts, add:

```json
"test:device": "node build/browser.mjs && node test-device/run.mjs"
```

- [ ] **Step 7: Run the selftest**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node test-device/selftest/runner.mjs
```

Expected: `RUNNER SELFTEST PASSED`, all eight checks.

- [ ] **Step 8: Prove teeth**

Move the undo-unwind loop inside the `try` block (so it only runs on success). Re-run. Expected: "undo runs after a thrown scenario" fails. Restore it.

- [ ] **Step 9: Commit**

```bash
git add test-device/runner.ts test-device/report.ts test-device/types.ts \
        test-device/selftest/runner.mjs build/browser.mjs package.json .gitignore
git commit -m "test-device: scenario runner with LIFO teardown and tiered reporting

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `fixture.ts` — port the device fixture

**Files:**
- Create: `movy/test-device/fixture.ts`
- Read (do not modify): `movy/scripts/lib/test-set.sh`, `movy/scripts/fixtures/README.md`
- Test: `movy/test-device/selftest/fixture.mjs`

**Interfaces:**
- Consumes: `Bus` (Task 2), `until` (Task 3).
- Produces:
  - `ensure(bus: Bus, host: string): Promise<void>` — the `test_set_begin` equivalent
  - `verify(host: string): Promise<boolean>` — the `ts_verify` batched read-back
  - `verifyChains(host: string): Promise<boolean>` — `ts_verify_chains`
  - `fixtureSynth(track: number): Promise<string>` — `ts_fixture_synth`
  - `installMovyState(host: string): Promise<void>` — `ts_install_movy_state`

**Port faithfully.** `test-set.sh`'s comments record behaviours learned on device — the six load attempts (a set_param into the chain host's single-slot SHM can be *dropped*, so a failed attempt says nothing about the next), the cold-chain boot seed, the `ts_verify` fast path that short-circuits in ~2 s. Keep every one of those, and carry the comment explaining why. Do not redesign the seeding.

- [ ] **Step 1: Read the source of truth**

```bash
cd /Users/dake/git/cld/movy && sed -n '1,120p' scripts/lib/test-set.sh
sed -n '620,724p' scripts/lib/test-set.sh
cat scripts/fixtures/README.md
```

- [ ] **Step 2: Write the failing selftest**

Create `movy/test-device/selftest/fixture.mjs` — device test, skips when unreachable.

```js
import { Bus } from '../../dist/esm/test-device/bus.js';
import { ensureDaemon, stopDaemon } from '../../dist/esm/test-device/daemon.js';
import * as fixture from '../../dist/esm/test-device/fixture.js';

const HOST = process.env.HOST || 'move.local';
let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l); else { console.log('✗ ' + l + '  ' + d); fails++; } };

const { startedByUs } = await ensureDaemon(HOST);
const bus = new Bus(HOST);
await bus.connect();

const t0 = Date.now();
await fixture.ensure(bus, HOST);
const secs = (Date.now() - t0) / 1000;
ok('fixture.ensure completes', true, `${secs.toFixed(1)}s`);
ok('fixture.ensure takes the fast path when already correct', secs < 30, `${secs.toFixed(1)}s`);
ok('verify agrees afterwards', await fixture.verify(HOST));
ok('verifyChains agrees afterwards', await fixture.verifyChains(HOST));

const synth = await fixture.fixtureSynth(0);
ok('track 0 names its instrument', synth.length > 0, synth);

bus.close();
if (startedByUs) await stopDaemon(HOST);
console.log(fails === 0 ? 'FIXTURE SELFTEST PASSED' : `${fails} FIXTURE CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /Users/dake/git/cld/movy && node test-device/selftest/fixture.mjs
```

Expected: FAIL — cannot find `dist/esm/test-device/fixture.js`.

- [ ] **Step 4: Implement `fixture.ts`**

Translate function by function from `scripts/lib/test-set.sh`. The shape (fill in each body from the shell source — the comments there are the spec):

```ts
/* TS port of scripts/lib/test-set.sh. The behaviours encoded here were learned
 * on device and are NOT simplifications to revisit — see the shell source's
 * comments, which are carried across with each function. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Bus } from './bus.js';

const run = promisify(execFile);
const DEVICE_DIR = '/data/UserData/schwung/_movy-fixture';

export async function ssh(host: string, cmd: string): Promise<string> {
    const { stdout } = await run('ssh', [`ableton@${host}`, cmd]);
    return stdout;
}

/* ts_verify: ONE batched read-back of the whole chain. Cheap (~2 s) and the
 * reason ensure() usually costs nothing: re-loading modules that are already
 * loaded cost ~60 s per suite for no change. */
export async function verify(host: string): Promise<boolean> { /* ... */ }

export async function verifyChains(host: string): Promise<boolean> { /* ... */ }

export async function installMovyState(host: string): Promise<void> { /* ... */ }

export async function fixtureSynth(track: number): Promise<string> { /* ... */ }

/* test_set_begin. Verify FIRST; only a genuine mismatch pays for an apply.
 *
 * Six attempts, not three: a module load is a set_param into the chain host's
 * single-slot param SHM, where a write can be DROPPED rather than merely slow,
 * so an attempt failing says nothing about the next. Three was demonstrably
 * marginal — one suite in a sweep recovered on attempt 3 while another gave up
 * at the same boundary. */
export async function ensure(bus: Bus, host: string): Promise<void> { /* ... */ }
```

Replace each `/* ... */` with the translated body. The shell source for each,
by line range in `scripts/lib/test-set.sh` — translate one at a time and carry
each function's comment across verbatim:

| TS function | shell function | lines |
| --- | --- | --- |
| `verify` | `ts_verify` | 236–256 |
| `verifyChains` | `ts_verify_chains` | 583–619 |
| `installMovyState` | `ts_install_movy_state` | 620–628 |
| `fixtureSynth` | `ts_fixture_synth` | 565–582 |
| `ensure` | `test_set_begin` | 629–701 |

`ensure` additionally calls `ts_push_fixture` (135–148), `ts_chain_is_cold`
(149–172), `ts_seed_boot_state` (173–194) and `ts_apply` (205–235); port those
as non-exported helpers in the same file.

Two deliberate changes from the shell, and only these two:

1. The `sleep 3` between load attempts becomes `await bus.frames(1000)` (~2.9 s of device frames).
2. `test_set_end`'s stack restart is **not** ported. `test_set_end`'s own comment says closing movy is what hands the LEDs back and the full restart is already reserved for `TS_FULL_RESTART=1`; the close lives in `device.ts` (Task 6).

- [ ] **Step 4b: Add the typed `need` helpers and the between-scenario check**

The design's §4.2 shows `t.need.track(...)` / `t.need.clip(...)`, not just the
raw `register`. Add to `fixture.ts`:

```ts
/* Declare-and-unwind. Each helper is a no-op when the fixture already satisfies
 * the requirement, and registers its own undo when it had to change something —
 * so a scenario pays only for what it actually dirties. */
export function needApi(bus: Bus, host: string, register: (undo: () => Promise<void>) => void) {
    return {
        register,
        async track(n: number, moduleId: string): Promise<void> {
            const have = await fixtureSynth(n);
            if (have === moduleId) return;
            throw new Error(`fixture has ${have || 'nothing'} on track ${n}, scenario needs ${moduleId}`);
        },
        async clip(track: number, spec: { steps: number[] }): Promise<void> {
            const before = await bus.getParam('overtake_dsp:status');
            for (const st of spec.steps) await bus.setParam('overtake_dsp:cmd', `tog ${track} ${st}`);
            register(async () => { await bus.setParam('overtake_dsp:cmd', `clipdel ${track}`); void before; });
        },
    };
}
```

`need.track` throws rather than reseeding: a scenario asking for a module the
fixture does not provide is a scenario bug, and silently reseeding would hide it
behind a 60 s load. Wire `needApi` into `runner.ts`'s `Ctx`, and pass
`beforeEach: () => fixture.verify(host).then((okv) => okv ? undefined : fixture.ensure(bus, host))`
from `run.mjs`.

- [ ] **Step 5: Add `test-device/fixture.ts` to `build/browser.mjs`, rebuild, run**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node test-device/selftest/fixture.mjs
```

Expected: `FIXTURE SELFTEST PASSED`, five checks, and the fast path well under 30 s.

- [ ] **Step 6: Prove teeth**

Make `verify()` return `true` unconditionally. Re-run *after* perturbing a chain slot:

```bash
node scripts/module-slot.mjs --clear 1 || true
node test-device/selftest/fixture.mjs
```

Expected: with the stub, `verifyChains` still catches it and the run fails; then restore `verify()` and confirm `ensure()` reseeds and everything goes green.

- [ ] **Step 7: Commit**

```bash
git add test-device/fixture.ts test-device/selftest/fixture.mjs build/browser.mjs
git commit -m "test-device: port the device fixture from test-set.sh

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `device.ts` — gestures and lifecycle

**Files:**
- Create: `movy/test-device/device.ts`
- Create: `movy/test-device/gestures.ts`
- Test: `movy/test-device/selftest/device.mjs`

**Interfaces:**
- Consumes: `Bus` (2), `until` (3), `fixture` (5), the Task 1 findings.
- Produces, on a `Device` class:
  - `tap.cc(n, v?)`, `tap.note(n, v?)`, `tap.steps(ns)`, `tap.knob(k, delta)` — knob deltas use schwung's re-encoding (1–63 clockwise, 65–127 counter-clockwise)
  - `hold(n, body: () => Promise<void>)` — note-on, run body, note-off
  - `open()`, `close()`, `reopen()`, `park()`, `unpark()`
  - `selectTrack(n)`, `swapEngine(localPath)`, `restartStack()`
  - `deployUi()`, `param.get(key)`, `param.set(key, v)`
  - `overtakeReady(): Promise<void>` — the two-gate wait

**The two-gate wait is the single most important thing in this task.** Port `wait_for_overtake_dsp` from `schwung/tools/pytest-schwung/src/schwung_bus/client.py`: the overtake DSP load runs on the shim worker, so the mode flips when the load is *requested* and the instance appears up to ~200 ms later; MIDI injected in between is silently dropped against the shim's `overtake_dsp_gen && overtake_dsp_gen_inst` guards. Gate on `overtake_mode == 2` **then** on `overtake_dsp:__ready` leaving `"0"`. When the mode is already 2 on the first poll (a module→module switch presents no observable `2 → x → 2` transition), wait bounded for `__ready` to reach `"0"` first. Separate frame budgets per gate, so a slow mode flip cannot consume the whole budget and leave a DSP error reported without a single `__ready` read having happened.

- [ ] **Step 1: Read the reference implementation**

```bash
grep -n "wait_for_overtake_dsp" -A 60 \
  /Users/dake/git/cld/schwung/tools/pytest-schwung/src/schwung_bus/client.py
```

- [ ] **Step 2: Write the failing selftest**

Create `movy/test-device/selftest/device.mjs` — device test.

```js
import { Bus } from '../../dist/esm/test-device/bus.js';
import { ensureDaemon, stopDaemon } from '../../dist/esm/test-device/daemon.js';
import { Device } from '../../dist/esm/test-device/device.js';
import * as fixture from '../../dist/esm/test-device/fixture.js';

const HOST = process.env.HOST || 'move.local';
let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l); else { console.log('✗ ' + l + '  ' + d); fails++; } };

const { startedByUs } = await ensureDaemon(HOST);
const bus = new Bus(HOST); await bus.connect();
await fixture.ensure(bus, HOST);
const dev = new Device(bus, HOST);

await dev.open();
const st = await bus.state();
ok('open() leaves overtake_mode at 2', st.overtake_mode === 2, JSON.stringify(st));

const ready = await bus.getParam('overtake_dsp:__ready');
ok('the engine reports ready after open()', ready !== '0', ready);

const t0 = Date.now();
await dev.reopen();
ok('reopen() completes', (await bus.state()).overtake_mode === 2);
ok('reopen() is under 6s', (Date.now() - t0) / 1000 < 6, `${((Date.now() - t0) / 1000).toFixed(1)}s`);

await dev.selectTrack(0);
ok('selectTrack(0) lands', (await bus.state()).ui_slot === 0, String((await bus.state()).ui_slot));

/* A press/release delivered as ONE gesture must read as a tap, not a hold:
 * that distinction is the whole reason test-set.sh needed device-side scripts. */
const before = await bus.state();
await dev.tap.cc(3);
const after = await bus.state();
ok('tap.cc round-trips without wedging the bus', after.shim_counter >= before.shim_counter);

await dev.close();
ok('close() drops overtake_mode', (await bus.state()).overtake_mode !== 2);

bus.close();
if (startedByUs) await stopDaemon(HOST);
console.log(fails === 0 ? 'DEVICE SELFTEST PASSED' : `${fails} DEVICE CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /Users/dake/git/cld/movy && node test-device/selftest/device.mjs
```

Expected: FAIL — cannot find `dist/esm/test-device/device.js`.

- [ ] **Step 4: Write `gestures.ts`**

```ts
import { cc, noteOn, noteOff, type Packet } from './midi.js';
import type { Bus } from './bus.js';

/* Schwung re-encodes accumulated knob deltas before handing them to a module:
 * 1..63 clockwise, 65..127 counter-clockwise. Sending a raw signed delta makes
 * a counter-clockwise turn read as a large clockwise one. */
export function knobCc(delta: number): number {
    return delta > 0 ? Math.min(delta, 63) : Math.max(128 + delta, 65);
}

/* One gesture is one pair of packets with no ssh between them. Under the old
 * harness each inject was its own ~500 ms round trip, so a press/release pair
 * WAS a >500 ms hold and movy read it as a different gesture entirely. */
export async function tapPackets(bus: Bus, on: Packet, off: Packet, holdFrames = 2): Promise<void> {
    await bus.injectMidi(on);
    await bus.frames(holdFrames);
    await bus.injectMidi(off);
}

export const ccOn  = (n: number, v = 127) => cc(n, v);
export const ccOff = (n: number) => cc(n, 0);
export { noteOn, noteOff };
```

- [ ] **Step 5: Write `device.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Bus } from './bus.js';
import { until } from './wait.js';
import { cc, noteOn, noteOff } from './midi.js';
import { knobCc, tapPackets } from './gestures.js';

const run = promisify(execFile);

const CC_JOG = 3, CC_JOG_TURN = 14, CC_BACK = 51;
const KNOB_CC_BASE = 71, TRACK_CC_BASE = 40;
const REMOTE = '/data/UserData/schwung/modules/tools/movy';

export class Device {
    constructor(private bus: Bus, private host: string) {}

    readonly tap = {
        cc: async (n: number, v = 127) => tapPackets(this.bus, cc(n, v), cc(n, 0)),
        note: async (n: number, v = 100) => tapPackets(this.bus, noteOn(n, v), noteOff(n)),
        steps: async (ns: number[]) => { for (const n of ns) await this.tap.note(n, 127); },
        knob: async (k: number, delta: number) => {
            await this.bus.injectMidi(cc(KNOB_CC_BASE + k, knobCc(delta)));
        },
        jog: async () => this.tap.cc(CC_JOG),
        jogTurn: async (dir: 1 | -1) => this.bus.injectMidi(cc(CC_JOG_TURN, dir > 0 ? 1 : 127)),
    };

    /* note-on, body, note-off — a real hold, with the body free to inject other
     * events inside it. This is how a held step + knob turn is expressed. */
    async hold(note: number, body: () => Promise<void>): Promise<void> {
        await this.bus.injectMidi(noteOn(note, 127));
        try { await body(); } finally { await this.bus.injectMidi(noteOff(note)); }
    }

    /* Two gates, separate budgets. See the task notes: a bare mode poll loses
     * the first injected event, and a bare __ready poll passes against the
     * PREVIOUS module's state because __ready answers "1" whenever nothing is
     * loading — including before the load has started. */
    async overtakeReady(): Promise<void> {
        const modeNow = (await this.bus.state()).overtake_mode;
        if (modeNow === 2) {
            /* Already 2: a module→module switch shows no 2 → x → 2 transition,
             * so wait (bounded) for the only observable marker that a load
             * actually started. A module with no dsp.so never drives this, so
             * the budget expiring here is tolerated, not fatal. */
            try {
                await until(this.bus, 'overtake_dsp:__ready to go 0',
                    () => this.bus.getParam('overtake_dsp:__ready').catch(() => '1'),
                    (v) => v === '0', { within: 170 });
            } catch { /* no dsp, or the load was instant — fall through */ }
        }
        await until(this.bus, 'overtake_mode == 2',
            async () => (await this.bus.state()).overtake_mode, (m) => m === 2, { within: 2000 });
        await until(this.bus, 'overtake_dsp:__ready',
            () => this.bus.getParam('overtake_dsp:__ready').catch(() => '1'),
            (v) => v !== '0', { within: 2000 });
    }

    async open(): Promise<void> { await this.bus.openTool('movy'); await this.overtakeReady(); }

    /* Back x3: knobs → chain → exit. */
    async close(): Promise<void> {
        for (let i = 0; i < 3; i++) await this.tap.cc(CC_BACK);
        await until(this.bus, 'overtake_mode to leave 2',
            async () => (await this.bus.state()).overtake_mode, (m) => m !== 2, { within: 2000 });
    }

    async reopen(): Promise<void> { await this.close(); await this.open(); }

    async selectTrack(n: number): Promise<void> {
        await this.tap.cc(TRACK_CC_BASE + (3 - (n % 4)));
        await until(this.bus, `ui_slot == ${n % 4}`,
            async () => (await this.bus.state()).ui_slot, (s) => s === n % 4, { within: 700 });
    }

    async deployUi(): Promise<void> {
        await run('node', ['build/device.mjs']);
        await run('scp', ['-q', 'ui.js', `ableton@${this.host}:${REMOTE}/`]);
    }

    /* Atomic: never scp over a dlopen'd .so in place — overwriting a mapped
     * .so's inode corrupts its pages and crashes MoveOriginal. Whether the
     * reopen alone suffices is answered by the Task 1 spike; set
     * MOVY_ENGINE_NEEDS_RESTART=1 if it said NO. */
    async swapEngine(localPath: string): Promise<void> {
        await this.close();
        await run('scp', ['-q', localPath, `ableton@${this.host}:${REMOTE}/dsp.so.new`]);
        await run('ssh', [`ableton@${this.host}`, `mv ${REMOTE}/dsp.so.new ${REMOTE}/dsp.so`]);
        if (process.env.MOVY_ENGINE_NEEDS_RESTART === '1') await this.restartStack();
        await this.open();
    }

    async restartStack(): Promise<void> {
        await this.bus.restartMove();
        await until(this.bus, 'the stack to come back',
            () => this.bus.ping().catch(() => ''), (v) => v.startsWith('schwung-testd'), { within: 6000 });
    }

    readonly param = {
        get: (key: string) => this.bus.getParam(key),
        set: (key: string, v: string) => this.bus.setParam(key, v),
    };
}
```

`park()` / `unpark()` are added in Task 9 alongside the probe, since asserting `overtakeParked` needs the probe to read it.

- [ ] **Step 6: Add both files to `build/browser.mjs`, rebuild, run**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node test-device/selftest/device.mjs
```

Expected: `DEVICE SELFTEST PASSED`, seven checks, `reopen()` under 6 s (compare: the bash suites spend `sleep 3` + `sleep 3.5` on the same thing and still lose events).

- [ ] **Step 7: Prove teeth**

In `overtakeReady()`, delete the second `until` (the `__ready` gate). Re-run `device.mjs` in a loop of 3. Expected: at least one run shows `the engine reports ready after open()` failing or a dropped event. Restore it.

- [ ] **Step 8: Commit**

```bash
git add test-device/device.ts test-device/gestures.ts test-device/selftest/device.mjs build/browser.mjs
git commit -m "test-device: gestures and movy lifecycle

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Migrate `test-auto.sh` using existing observability

**Files:**
- Create: `movy/test-device/scenarios/automation.ts`
- Create: `movy/test-device/log.ts`
- Create: `movy/test-device/run.mjs`
- Test: the scenario itself

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `class LogTail` with `start(): Promise<void>`, `read(): Promise<string[]>`, `stop(): Promise<void>` — deduplicated, since two sinks write `debug.log`.

**This task deliberately lands before the schwung hook.** It proves the transport win (61 s baseline) with zero schwung changes, using the same log-line observations the bash suite uses. Task 9 then tightens the assertions onto the probe. That ordering is the spec's §5.4 degradation path made real, and it means a stalled schwung PR costs fidelity, not the whole framework.

- [ ] **Step 1: Re-measure the baseline**

```bash
cd /Users/dake/git/cld/movy && time ./scripts/test-auto.sh move.local 2>&1 | tail -20
```

Record the wall clock. The reference measurement on 2026-09-11 was **61 s for 7 assertions, all green**.

- [ ] **Step 2: Write `log.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const LOG = '/data/UserData/schwung/debug.log';

/* Until SUBSCRIBE log lands in schwung-testd (Task 8), the log still comes over
 * ssh — but a scenario reads it ONCE at the end rather than per assertion.
 *
 * The device can have two sinks writing debug.log (shadow_ui's own writer plus
 * the unified-log pipe), so one event appears twice with different prefixes and
 * timestamps up to a millisecond apart. These assertions count EVENTS, so a raw
 * line count silently doubles every one. Same message within 5 ms = one event. */
export class LogTail {
    constructor(private host: string) {}

    async start(): Promise<void> {
        await run('ssh', [`ableton@${this.host}`,
            `touch /data/UserData/schwung/debug_log_on; > ${LOG}`]);
    }

    async read(): Promise<string[]> {
        const { stdout } = await run('ssh', [`ableton@${this.host}`,
            `grep '\\[movy\\]' ${LOG} 2>/dev/null || true`], { maxBuffer: 32 * 1024 * 1024 });
        const seen = new Map<string, number>();
        const out: string[] = [];
        for (const raw of stdout.split('\n')) {
            const line = raw.replace(/\[[A-Z ]+\] \[[a-z-]+\] /, '');
            if (!line.trim()) continue;
            const sp = line.indexOf(' ');
            const [h, m, s] = line.slice(0, sp).split(':').map(Number);
            const now = (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
            const msg = line.slice(sp + 1);
            const prev = seen.get(msg);
            if (prev !== undefined && now - prev < 0.005) continue;
            seen.set(msg, now);
            out.push(line);
        }
        return out;
    }

    async stop(): Promise<void> { /* nothing to tear down; the log stays on */ }
}
```

- [ ] **Step 3: Write `scenarios/automation.ts`**

Port every one of `test-auto.sh`'s seven checks. Read the shell source alongside: `sed -n '1,220p' scripts/test-auto.sh`.

```ts
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { LogTail } from '../log.js';
import { until } from '../wait.js';
import * as fixture from '../fixture.js';

const CC_PLAY = 85, CC_REC = 86, KNOB = 4;   // knob index 4 → CC 75
const STEP1 = 16, STEP5 = 20, PAD = 68;

/* Distinct held/live values, parsed out of the automation render line. */
const distinct = (lines: string[], held: 0 | 1): number => {
    const vals = new Set<string>();
    for (const l of lines) {
        if (!l.includes(`auto render held=${held}`)) continue;
        for (const m of l.matchAll(/t1=(\d+)%/g)) vals.add(m[1]);
    }
    return vals.size;
};

scenario('automation', async (t) => {
    const dev = new Device(t.bus, t.host);
    const log = new LogTail(t.host);

    await fixture.ensure(t.bus, t.host);
    await dev.deployUi();
    await log.start();
    await dev.reopen();
    await dev.selectTrack(0);

    /* A module whose root level fills all 8 encoders gets a dedicated Preset
     * page placed BEFORE Main, and the preset knob is deliberately
     * non-automatable. Movy lands on that page, so without paging past it this
     * scenario drives a knob that can never hold automation and every check
     * fails for the wrong reason. */
    await dev.tap.jog();
    for (let i = 0; i < 3; i++) {
        const seen = await log.read();
        const cur = seen.filter((l) => l.includes('auto render')).pop() ?? '';
        if (!/auto render .*\| PRESE:[^ ]*$/.test(cur)) break;
        await dev.tap.jogTurn(1);
        await t.bus.frames(170);
    }

    // ── P1/P2: hold a step and turn an automatable knob ──────────────────────
    await dev.tap.note(PAD, 100);            // set step-entry pitch
    await dev.tap.note(STEP1, 127);          // place a note (auto-clip)
    await dev.tap.cc(CC_PLAY);
    await t.bus.frames(170);

    await dev.hold(STEP5, async () => {
        /* Sweep up then down: bidirectional, so we get distinct values whatever
         * the base is, instead of clamping at a rail and yielding exactly one. */
        for (let i = 0; i < 3; i++) { await dev.tap.knob(KNOB, 12);  await t.bus.frames(100); }
        for (let i = 0; i < 3; i++) { await dev.tap.knob(KNOB, -12); await t.bus.frames(100); }
    });
    await t.bus.frames(270);

    const held = await log.read();
    t.note('heldLines', held.filter((l) => l.includes('auto render held=1')).slice(-8));

    t.check('p1-highlight', 'held-step value is highlighted while holding',
        held.some((l) => /auto render held=1.*t1=/.test(l)));

    const heldN = distinct(held, 1);
    t.check('p1-live', 'held value updates live while turning',
        heldN >= 2, { expected: '>=2 distinct values', actual: String(heldN) });

    t.check('p2-dot', 'the automation dot shows on the automated param',
        held.some((l) => /auto render .*:a1t/.test(l)));

    // ── P4: a LIVE record take (no step held) repaints and accumulates ───────
    await dev.tap.cc(CC_REC);
    await until(t.bus, 'the count-in to elapse',
        () => t.bus.getParam('overtake_dsp:status'),
        (s) => /rec=1/.test(s), { within: 2000 });

    for (let i = 0; i < 4; i++) { await dev.tap.knob(KNOB, -12); await t.bus.frames(85); }
    await log.start();                        // isolate the up-sweep frames
    for (let i = 0; i < 4; i++) { await dev.tap.knob(KNOB, 12);  await t.bus.frames(100); }
    await t.bus.frames(200);
    await dev.tap.cc(CC_REC);

    const live = await log.read();
    t.note('liveLines', live.filter((l) => l.includes('auto render held=0')).slice(-8));

    t.check('p4-repaint', 'live-record value is highlighted while turning',
        live.some((l) => /auto render held=0.*t1=/.test(l)));

    const liveN = distinct(live, 0);
    /* An accumulating up-sweep gives several ascending values; a take that
     * fails to accumulate sticks at base+one-delta — the "snaps back" bug. */
    t.check('p4-accumulate', 'live-record value accumulates across the take',
        liveN >= 3, { expected: '>=3 distinct values', actual: String(liveN) });

    // ── P3: the lane registry repopulates from restore on reopen ─────────────
    await log.start();
    await dev.reopen();
    await dev.selectTrack(0);
    await dev.tap.jog();
    await t.bus.frames(170);

    const after = await log.read();
    t.note('lanesAfterReopen', after.filter((l) => l.includes('auto lanes')).slice(-4));

    t.check('p3-registry', 'the lane registry repopulated from restore',
        after.some((l) => /auto lanes t=\d+ \[[^\]]+\]/.test(l)));

    t.check('p3-dot', 'the dot shows on reopen without re-touching a knob',
        after.some((l) => /auto render .*:a1t/.test(l)));
});
```

- [ ] **Step 4: Write `run.mjs`**

```js
#!/usr/bin/env node
/* Device scenario entry point. */
import { Bus } from '../dist/esm/test-device/bus.js';
import { ensureDaemon, stopDaemon } from '../dist/esm/test-device/daemon.js';
import { runAll } from '../dist/esm/test-device/runner.js';
import '../dist/esm/test-device/scenarios/automation.js';

const HOST = process.env.HOST || process.argv[2] || 'move.local';
const only = process.argv.includes('--scenario')
    ? process.argv[process.argv.indexOf('--scenario') + 1] : undefined;

const { startedByUs } = await ensureDaemon(HOST);
const bus = new Bus(HOST);
await bus.connect();
const failures = await runAll({ host: HOST, only, busFactory: () => bus });
bus.close();
if (startedByUs) await stopDaemon(HOST);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 5: Run and compare against the baseline**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && time node test-device/run.mjs move.local
```

Expected: all seven checks green, and **substantially faster than the recorded baseline**. Record the number in the commit message. If it is not faster, do not proceed — find out which wait is dominating (`.test-out/automation.md` carries per-check timing) before adding more scenarios.

- [ ] **Step 6: Prove teeth, per check**

For each of the seven checks, break the thing it guards and confirm only that check fails. The cheapest breakages:

- `p1-live` / `p4-accumulate`: change the knob sweep to a single `dev.tap.knob(KNOB, 12)` — the distinct-value count drops to 1.
- `p2-dot` / `p3-dot`: in `src/app/tick.ts`, make `diagAutoRender` emit `a0` unconditionally.
- `p3-registry`: in `src/app/tick.ts`, replace `laneKeysForTrack(...)` with `[]`.
- `p1-highlight` / `p4-repaint`: make `diagAutoRender` emit `t0` unconditionally.

Redeploy, run, confirm the expected check(s) fail and the rest stay green, restore.

- [ ] **Step 7: Retire the bash suite**

```bash
git rm scripts/test-auto.sh
```

Remove `test-auto.sh` from `SCRIPTS` in `scripts/test-all-device.sh`. Check `browser-test/device-scripts.mjs` for assertions naming `test-auto.sh` and remove those; run `node browser-test/device-scripts.mjs` to confirm it still passes.

- [ ] **Step 8: Run the full local gate**

```bash
cd /Users/dake/git/cld/movy && npm test
```

Expected: 0 failures across all eight suites.

- [ ] **Step 9: Commit**

```bash
git add test-device/scenarios/automation.ts test-device/log.ts test-device/run.mjs \
        test-device/runner.ts scripts/test-all-device.sh browser-test/device-scripts.mjs
git rm --cached scripts/test-auto.sh 2>/dev/null || true
git commit -m "test-device: migrate test-auto.sh (61s -> <N>s)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: schwung — testd snapshots, MODULE_STATE, and the shadow_ui probe hook

**Files (all in a FORK clone, never the reference checkout):**
- Create: `/Users/dake/git/cld/schwung-testfw` (fork clone, branch `test-bus-module-state`)
- Modify: `src/host/test_daemon/commands.c`, `src/host/test_daemon/commands.h`
- Create: `src/host/test_daemon/probe_shm.h`
- Modify: `src/shadow/shadow_ui.c`, `src/shadow/shadow_ui.js`
- Modify: `tools/pytest-schwung/README.md` (protocol table)
- Create: `tests/host/test_module_state_probe.sh`

**Interfaces:**
- Produces, on the testd wire protocol:
  - `SNAPSHOT_DISPLAY` → `OK <2048 hex chars>` (1024 bytes: 128×64, 8 pages of 128 bytes, bit 0 topmost)
  - `SNAPSHOT_STEP_LEDS` → `OK <hex>` from `shadow_overlay_state_t.step_led_colors`
  - `MODULE_STATE <one line of JSON>` → `OK <json>` or `ERR MODULE_STATE: no provider registered`
- Produces, in the JS context: `globalThis.shadow_register_test_state(fn)` where `fn: (requestJson: string) => string`

The design doc's §5.1 also lists a `SUBSCRIBE log` channel. **Deliberately not built:** Task 7's `log.ts` reads the log once per scenario rather than per assertion, and Task 9 removes the log path from the automation scenario altogether. Add it only when a scenario actually needs frame-stamped log events.

**Doorbell placement — do not put it in `shadow_control_t`.** `schwung-manager/shmconfig.go` maps `min(256, segment-on-disk)` precisely because a segment left by an older shim is SHORTER and touching past EOF is SIGBUS, not a zero. A test-only feature must not inherit that hazard. Create a separate segment `/dev/shm/schwung-test-probe` in the daemon; shadow_ui maps it lazily and treats an absent segment as "feature off", so neither side version-couples to the other.

- [ ] **Step 1: Fork and clone**

```bash
cd /Users/dake/git/cld
gh repo fork <schwung-upstream> --clone=false --remote=false 2>/dev/null || true
git clone <your-fork-url> schwung-testfw
cd schwung-testfw && git checkout -b test-bus-module-state
```

- [ ] **Step 2: Add the two snapshot commands**

In `src/host/test_daemon/commands.c`, next to `cmd_snapshot_pad_leds` (~line 159), add `cmd_snapshot_display` and `cmd_snapshot_step_leds`, and register both in the dispatch table (~line 800). `SNAPSHOT_STEP_LEDS` has a comment at line 172 saying it was deferred — that comment is the spec for it; delete the comment when you implement it. `SNAPSHOT_DISPLAY` reads `/dev/shm/schwung-display` (note: **not** `schwung-display-live`, which is the manager's overlay buffer and stays blank while a tool owns the screen — exactly when a test wants a shot).

- [ ] **Step 3: Add the probe SHM and `MODULE_STATE`**

Create `src/host/test_daemon/probe_shm.h` with a 4 KiB struct: `uint32_t request_seq; uint32_t response_seq; char request[1024]; char response[3072];`. `cmd_module_state` writes the request, bumps `request_seq`, spins on `response_seq` matching (same poll interval and timeout shape as `cmd_get_param`, which already solves this against `/schwung-param`), and returns the response.

- [ ] **Step 4: Add the shadow_ui builtin**

In `src/shadow/shadow_ui.c`, mirror `js_shadow_get_open_tool_cmd` (line 229) and its registration (line 3201):

- `shadow_get_test_probe_req()` → the pending request string, or `null`. Maps `/dev/shm/schwung-test-probe` lazily; returns `null` forever if it does not exist.
- `shadow_put_test_probe_resp(str)` → writes the response and bumps `response_seq`.

- [ ] **Step 5: Add the JS hook**

In `src/shadow/shadow_ui.js`, add near the `open_tool_cmd` handler (~line 25363):

```js
/* Module test-state provider. A module registers one function; the test bus
 * asks it a question and gets its answer back. Pull-only: nothing runs unless a
 * test asks, and an absent /dev/shm/schwung-test-probe means the builtin
 * answers null forever, so this costs one call per tick and nothing else. */
let testStateProvider = null;
globalThis.shadow_register_test_state = function (fn) {
    testStateProvider = typeof fn === "function" ? fn : null;
};

if (typeof shadow_get_test_probe_req === "function") {
    const req = shadow_get_test_probe_req();
    if (req !== null && req !== undefined && req !== "") {
        let resp;
        try {
            resp = testStateProvider ? testStateProvider(req) : JSON.stringify({ error: "no provider" });
        } catch (e) {
            resp = JSON.stringify({ error: String(e) });
        }
        shadow_put_test_probe_resp(typeof resp === "string" ? resp : JSON.stringify(resp));
    }
}
```

Clear `testStateProvider` wherever `unloadModuleUi()` tears a module down, so a stale provider from a closed module cannot answer for the next one.

- [ ] **Step 6: Write the schwung host test**

Create `tests/host/test_module_state_probe.sh` following the idiom of the existing source-scraping tests in that directory (read `tests/host/test_stay_in_shadow.sh` for the shape). Assert: the provider is cleared on unload; the doorbell read is guarded by `typeof ... === "function"` so an older shim cannot break shadow_ui; and `MODULE_STATE` is in the command table.

- [ ] **Step 7: Build and deploy to the device**

```bash
cd /Users/dake/git/cld/schwung-testfw && DISABLE_SCREEN_READER=1 ./scripts/build.sh
scp build/bin/schwung-testd ableton@move.local:/data/UserData/schwung/bin/
scp src/shadow/shadow_ui.js ableton@move.local:/data/UserData/schwung/
```

Then restart the stack so the new `shadow_ui.js` is picked up.

- [ ] **Step 8: Verify on device**

```bash
ssh ableton@move.local 'pkill -f schwung-testd; SCHWUNG_TEST_BIND=0.0.0.0 nohup /data/UserData/schwung/bin/schwung-testd >/tmp/testd.log 2>&1 &'
printf 'PING\nSNAPSHOT_DISPLAY\nMODULE_STATE {"key":"tick"}\nQUIT\n' | nc move.local 47777
```

Expected: `OK schwung-testd …`; a 2048-hex-char display line; and `ERR MODULE_STATE: no provider registered` (movy has not registered one yet — that is Task 9).

- [ ] **Step 9: Open the upstream PR**

Title: "test-bus: display/step-LED snapshots and a module test-state provider". Body describes the three daemon commands and the one shadow_ui hook as test-bus capabilities from the daemon README's own roadmap. **Do not mention movy.** Include the `tests/host/` test and the README protocol-table update.

- [ ] **Step 10: Commit in the fork and note the PR in movy**

```bash
cd /Users/dake/git/cld/schwung-testfw
git add src/host/test_daemon src/shadow/shadow_ui.c src/shadow/shadow_ui.js \
        tests/host/test_module_state_probe.sh tools/pytest-schwung/README.md
git commit -m "test-bus: display/step-LED snapshots and a module test-state provider"
git push -u origin test-bus-module-state
```

Record the PR URL in `movy/plans/2026-09-11-device-test-framework-design.md` under §11.

---

### Task 9: movy's probe provider, and tightening the automation scenario

**Files:**
- Create: `movy/src/test/probe.ts`
- Modify: `movy/src/app/init.ts` (register the provider)
- Modify: `movy/src/app/tick.ts` (capture the last ViewModel + a render counter)
- Modify: `movy/src/types/schwung.d.ts` (declare the new global)
- Create: `movy/test-device/probe.ts`
- Modify: `movy/test-device/device.ts` (add `park()` / `unpark()`)
- Modify: `movy/test-device/scenarios/automation.ts`
- Modify: `movy/browser-test/logic/probe.mjs` (new local suite) and `movy/browser-test/logic.mjs` (register it)

**Interfaces:**
- Consumes: the Task 8 hook.
- Produces:
  - `movy/src/test/probe.ts`: `registerProbe(): void`, `noteRender(vm: ViewModel): void`
  - `movy/test-device/probe.ts`: `class Probe` with `available(): Promise<boolean>`, `tick()`, `page()`, `auto()`, `leds()`, `seq()`, `flags()`, `settled(bus)`, `setGridMode(m)`, `selectTrack(n)`
  - Probe response shapes, exactly:
    - `tick` → `{ tickSeq: number; renderSeq: number; dirty: boolean; parked: boolean }`
    - `page` → `{ pageIndex: number; pageCount: number; renderer: 'MOVY'|'DRAW'|'PAGE'; held: boolean; cells: Array<{ name: string; value: string; automated: boolean; touched: boolean } | null> }`
    - `auto` → `{ track: number; lanes: string[] }`

- [ ] **Step 1: Write the failing local suite**

Create `movy/browser-test/logic/probe.mjs` — host-only, so the provider's shape is pinned without a device.

```js
/* The probe's response shape is a contract the device scenarios parse. Pinning
 * it here means a rename in viewmodel.ts fails locally, not on hardware. */
import { ok, section } from './harness.mjs';
import { registerProbe, noteRender, _answer } from '../../dist/esm/test/probe.js';

export function run() {
    section('probe');

    const vm = {
        automationHeld: true,
        rows: [[{ shortName: 'DCAY', displayValue: '69%', automated: true, touched: true }, null, null, null],
               [null, null, null, null]],
        bankIndex: 2, bankCount: 5,
    };
    noteRender(vm);

    const tick = JSON.parse(_answer(JSON.stringify({ key: 'tick' })));
    ok('probe tick reports a renderSeq', typeof tick.renderSeq === 'number');
    const before = tick.renderSeq;
    noteRender(vm);
    const after = JSON.parse(_answer(JSON.stringify({ key: 'tick' }))).renderSeq;
    ok('renderSeq advances per render', after === before + 1, `${before} -> ${after}`);

    const page = JSON.parse(_answer(JSON.stringify({ key: 'page' })));
    ok('probe page reports held', page.held === true);
    ok('probe page reports the index', page.pageIndex === 2 && page.pageCount === 5);
    ok('probe page cell carries name/value', page.cells[0].name === 'DCAY' && page.cells[0].value === '69%');
    ok('probe page cell carries automated/touched',
        page.cells[0].automated === true && page.cells[0].touched === true);
    ok('probe page nulls empty cells', page.cells[1] === null);

    const bad = JSON.parse(_answer(JSON.stringify({ key: 'nope' })));
    ok('an unknown key answers with an error, not a throw', typeof bad.error === 'string');
}
```

Register it in `browser-test/logic.mjs` (both of the runner's two lists — grep for an existing subsystem name to find them).

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/dake/git/cld/movy && node browser-test/logic.mjs 2>&1 | tail -20
```

Expected: FAIL — cannot find `dist/esm/test/probe.js`.

- [ ] **Step 3: Write `src/test/probe.ts`**

```ts
/* Movy's answer to the schwung test bus: a ViewModel dump.
 *
 * Compiled into the SHIPPING bundle on purpose. A test-only build is a
 * different artifact from the one users run, so tests would be passing on a
 * binary nobody ships. This is pull-only — nothing here executes unless a test
 * asks a question — so it costs nothing to carry. */
import type { ViewModel } from '../types/viewmodel.js';

let lastVm: ViewModel | null = null;
let renderSeq = 0;
let tickSeq = 0;

/* Called from the render path. The counter is what test-device's
 * `movy.settled()` waits on, which is how a scenario proves movy PROCESSED an
 * input and repainted instead of guessing at a sleep. */
export function noteRender(vm: ViewModel): void { lastVm = vm; renderSeq++; }
export function noteTick(): void { tickSeq++; }

type Req = { key?: string; verb?: string; arg?: unknown };

export function _answer(requestJson: string): string {
    let req: Req;
    try { req = JSON.parse(requestJson); }
    catch (e) { return JSON.stringify({ error: 'bad request json: ' + String(e) }); }

    if (req.verb) return JSON.stringify(runVerb(req.verb, req.arg));

    switch (req.key) {
        case 'tick':
            return JSON.stringify({
                tickSeq, renderSeq,
                dirty: false,
                parked: (globalThis as any).overtakeParked === true,
            });
        case 'page': {
            const vm = lastVm;
            if (!vm) return JSON.stringify({ error: 'no render yet' });
            const cells = [];
            for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
                const pv = vm.rows[r]?.[c];
                cells.push(pv ? {
                    name: pv.shortName, value: pv.displayValue,
                    automated: !!pv.automated, touched: !!pv.touched,
                } : null);
            }
            return JSON.stringify({
                pageIndex: vm.bankIndex, pageCount: vm.bankCount,
                renderer: currentRenderer(), held: !!vm.automationHeld, cells,
            });
        }
        default:
            return JSON.stringify({ error: 'unknown key: ' + String(req.key) });
    }
}

export function registerProbe(): void {
    const g = globalThis as any;
    if (typeof g.shadow_register_test_state === 'function') g.shadow_register_test_state(_answer);
}
```

Three more pieces, all bounded:

- `currentRenderer()` — `src/renderer/schwung-grid.ts` already resolves
  MOVY/DRAW/PAGE; call its existing mode getter and return the string.
- `runVerb()` — exactly one verb for now, `setGridMode`, wrapping
  `setSchwungGridMode()` from `src/renderer/schwung-grid.ts`. It writes no flag
  and survives no reload, which is why it is safe to call mid-scenario.
- the `auto` key:

```ts
case 'auto': {
    const track = activeTrackIndex();
    return JSON.stringify({ track, lanes: laneKeysForTrack(track) });
}
```

  `laneKeysForTrack` is the same function `src/app/tick.ts:444` already calls to
  emit the `auto lanes` diagnostic.

**The `leds`, `seq` and `flags` keys listed in the design's §5.2 are deliberately
NOT built here.** No scenario needs them until the remaining 13 migrations, and a
probe key with no consumer is a contract nobody is checking. Add each one in the
migration that first needs it.

- [ ] **Step 4: Wire it into movy**

In `src/app/tick.ts`, call `noteRender(vm)` immediately beside the existing `diagAutoRender(vm)` call (line 218's function; grep for its call site). In `src/app/init.ts`, call `registerProbe()`. In `src/types/schwung.d.ts`, add:

```ts
/* Test bus (schwung PR test-bus-module-state). Absent on any host predating it,
 * so always guard with `typeof shadow_register_test_state === 'function'`. */
declare function shadow_register_test_state(fn: (req: string) => string): void;
```

- [ ] **Step 5: Run the local suite**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20
```

Expected: the eight probe checks pass, nothing else regresses.

- [ ] **Step 6: Write `test-device/probe.ts`**

```ts
import type { Bus } from './bus.js';
import { until } from './wait.js';

/* Degrades rather than breaks: if the schwung hook is absent — the PR is still
 * in flight, or a store update overwrote the deployed files — `available()`
 * answers false and scenarios fall back to log assertions. */
export class Probe {
    constructor(private bus: Bus) {}

    private async ask(req: object): Promise<any> {
        const r = await this.bus.send(`MODULE_STATE ${JSON.stringify(req)}`);
        return JSON.parse(r.slice(3));
    }

    async available(): Promise<boolean> {
        try { const t = await this.ask({ key: 'tick' }); return typeof t.renderSeq === 'number'; }
        catch { return false; }
    }

    tick()  { return this.ask({ key: 'tick' }); }
    page()  { return this.ask({ key: 'page' }); }
    auto()  { return this.ask({ key: 'auto' }); }
    flags() { return this.ask({ key: 'flags' }); }

    setGridMode(m: 'MOVY' | 'DRAW' | 'PAGE') { return this.ask({ verb: 'setGridMode', arg: m }); }

    /* Wait until movy has repainted since `from`. This is what replaces every
     * `sleep 0.45` after a gesture: a sleep asserts nothing, this proves movy
     * processed the input and rendered. */
    async settled(from: number): Promise<number> {
        const t = await until(this.bus, `renderSeq > ${from}`,
            () => this.tick(), (v) => v.renderSeq > from, { within: 700 });
        return t.renderSeq;
    }
}
```

- [ ] **Step 7: Add `park()` / `unpark()` to `device.ts`**

```ts
/* Background mode: movy parks under Move's UI. `overtakeParked` is a bare
 * global that THROWS if referenced while unset, which is why the probe reads it
 * through globalThis rather than by name. */
async park(probe: Probe): Promise<void> {
    await this.tap.cc(51);   // Back → Leave menu → background
    await until(this.bus, 'movy to park', () => probe.tick(), (t) => t.parked === true, { within: 1400 });
}
async unpark(probe: Probe): Promise<void> {
    await this.open();
    await until(this.bus, 'movy to unpark', () => probe.tick(), (t) => t.parked === false, { within: 1400 });
}
```

- [ ] **Step 8: Tighten `scenarios/automation.ts`**

Replace each log-grep check with its structural equivalent, keeping the same seven check ids so the artifact anchors stay stable. Guard the whole tightening on `await probe.available()`; when false, keep the Task 7 log path. Each `await t.bus.frames(N)` after a gesture becomes `seq = await probe.settled(seq)`.

```ts
const probe = new Probe(t.bus);
const structural = await probe.available();
t.note('probeAvailable', structural);

if (structural) {
    let seq = (await probe.tick()).renderSeq;
    const seen = new Set<string>();
    await dev.hold(STEP5, async () => {
        for (const d of [12, 12, 12, -12, -12, -12]) {
            await dev.tap.knob(KNOB, d);
            seq = await probe.settled(seq);
            const p = await probe.page();
            const cell = p.cells.find((c: any) => c && c.touched);
            if (cell) seen.add(cell.value);
            t.note(`sweep_${d}`, p.cells.filter((c: any) => c));
        }
    });
    t.check('p1-live', 'held value updates live while turning',
        seen.size >= 2, { expected: '>=2 distinct values', actual: String(seen.size) });
    // ...and so on for p1-highlight (cell.touched), p2-dot (cell.automated),
    //    p3-registry (probe.auto().lanes.length > 0), p3-dot, p4-*.
}
```

- [ ] **Step 9: Run against the device and re-time**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && ./scripts/deploy.sh move.local \
  && time node test-device/run.mjs move.local
```

Expected: seven checks green, `probeAvailable` true in `.test-out/automation.md`, and faster than the Task 7 number (the log reads over ssh are gone).

- [ ] **Step 10: Prove teeth on the structural checks**

Same four breakages as Task 7 Step 6, but now against the probe: make `noteRender` never update `lastVm` (expect every page-derived check to fail); force `automated: false` in `_answer` (expect `p2-dot`, `p3-dot`); return `lanes: []` (expect `p3-registry`). Restore after each.

- [ ] **Step 11: Full gate**

```bash
cd /Users/dake/git/cld/movy && npm test && node test-device/run.mjs move.local
```

Expected: 0 local failures, 0 device failures. If UI rendering changed at all, regenerate baselines first with `node browser-test/screenshot.mjs --update`.

- [ ] **Step 12: Update the docs and commit**

Add a **Device scenarios** subsection to `movy/CLAUDE.md` → Dev loop: `npm run test:device`, where scenarios live, the no-sleeps rule, and the probe's degradation behaviour. This is dev-only infrastructure, so `MANUAL.md` and `README.md` need no change.

```bash
git add src/test/probe.ts src/app/init.ts src/app/tick.ts src/types/schwung.d.ts \
        test-device/probe.ts test-device/device.ts test-device/scenarios/automation.ts \
        browser-test/logic/probe.mjs browser-test/logic.mjs CLAUDE.md
git commit -m "movy: ViewModel test probe, and structural automation assertions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

## Remaining migrations (not in this plan)

Tasks 1–9 deliver the framework plus one migrated suite. The other 13 follow the
same mechanical shape and should be planned separately once the automation
scenario has been green for a few sessions:

`test.sh`, `test-seq.sh`, `test-reselect.sh`, `test-unload.sh`, `test-mutes.sh`,
`test-volume.sh`, `test-module-contract.sh`, `test-master-fx.sh`, `test-lfo.sh`,
`test-items.sh`, `test-sends.sh`, `test-versions.sh`, `test-migrate.sh`, plus
`test-jog-hint.mjs` (which becomes the first `SNAPSHOT_DISPLAY` consumer).

Use the mapping table in §8 of the design doc. Delete each bash script only once
its scenario is green, and drop `scripts/lib/test-set.sh` and
`browser-test/device-scripts.mjs` when the last one goes.
