import type { Bus } from './bus.js';
import { until } from './wait.js';

/* Frames of silence around every probe read.
 *
 * The overtake_dsp param SHM is a SINGLE SLOT shared with movy's own writes, so
 * a read issued while movy is answering starves the answer outright — it is
 * lost, not delayed. Measured: eight requests spaced by a bare WAIT_FRAME all
 * answered, while a 30-frame poll loop in the gap answered the first few and
 * then never again. WAIT_FRAME touches no param, so this gap is genuinely
 * silent. ~150 frames is ~435 ms, which is the real cost of that single slot. */
const PROBE_GAP = 150;

const REQ = 'overtake_dsp:probereq';
const RSP = 'overtake_dsp:probersp';

/* Reads movy's UI state through the engine.
 *
 * schwung-testd's param bridge reaches the overtake DSP, never the UI's
 * QuickJS context, so the engine is used as a postbox: write the question to
 * `probereq`, movy notices it on the status poll it already makes, and writes
 * the answer to `probersp`.
 *
 * Degrades rather than breaks: on a movy without the bridge `available()`
 * answers false and a scenario falls back to log assertions. */
export class Probe {
    private id = 0;
    constructor(private bus: Bus) {}

    async ask(req: object): Promise<any> {
        const id = ++this.id;
        await this.bus.setParam(REQ, JSON.stringify({ id, ...req }));
        /* A QUIET WINDOW before the first read.
         *
         * The overtake_dsp param SHM is a single slot shared with movy's own
         * writes. Polling into it is not merely wasteful — it starves the reply
         * we are waiting for, and movy's answer is simply lost. Measured: three
         * requests spaced by a bare WAIT_FRAME all answered, while the same
         * three answered 1, then 2, then failed as soon as a poll loop ran in
         * the gap. WAIT_FRAME costs the daemon nothing and touches no param, so
         * this window is genuinely silent. */
        await this.bus.frames(PROBE_GAP);
        /* Waiting for OUR id, not merely for a non-empty value: the previous
         * answer is still sitting in the mailbox, so "has a response" would be
         * satisfied immediately and every read would be one round stale. */
        const raw = await until(this.bus, `probe reply #${id}`,
            () => this.bus.getParam(RSP).catch(() => ''),
            (v) => {
                if (!v) return false;
                try { return JSON.parse(v).id === id; } catch { return false; }
            /* Poll SLOWLY. The overtake_dsp param SHM is a SINGLE SLOT shared
             * with movy's own writes, so polling every couple of frames starves
             * the very reply we are waiting for: measured, the first request
             * answered and the second never did, while the same requests spaced
             * out all succeeded. */
            }, { within: 3000, every: PROBE_GAP });
        return JSON.parse(raw);
    }

    async available(): Promise<boolean> {
        try { return typeof (await this.ask({ key: 'tick' })).renderSeq === 'number'; }
        catch { return false; }
    }

    tick()  { return this.ask({ key: 'tick' }); }
    page()  { return this.ask({ key: 'page' }); }
    auto()  { return this.ask({ key: 'auto' }); }

    /* The internal mode strings, NOT the flag's display labels (the Settings
     * page shows MOVY/DRAW/PAGE for off/body/page). */
    setGridMode(m: 'off' | 'body' | 'page' | null) {
        return this.ask({ verb: 'setGridMode', arg: m });
    }

    /* Wait until movy has repainted since `from`. This replaces every
     * `sleep 0.45` after a gesture: a sleep asserts nothing, whereas this
     * proves movy processed the input AND rendered. */
    async settled(from: number): Promise<number> {
        const t = await until(this.bus, `renderSeq > ${from}`,
            () => this.tick(), (v) => v.renderSeq > from, { within: 3000, every: PROBE_GAP });
        return t.renderSeq;
    }
}
