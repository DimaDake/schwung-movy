import type { Probe } from './probe.js';
import type { Transport } from './transport.js';
import { until } from './wait.js';
import { applyRunMute } from './engine.js';
import {
    cc, noteOn, noteOff, knobDelta,
    CC_JOG_CLICK, CC_JOG_TURN, CC_BACK, CC_KNOB_BASE, CC_TRACK_BASE,
} from './midi.js';

/* Frames of silence after the host's gates, while movy restores the set.
 * ~900 frames is ~2.6 s. See open(). */
const RESTORE_QUIET = 900;

export class Device {
    constructor(private tx: Transport) {}

    readonly tap = {
        cc: async (n: number, v = 127) => {
            await this.tx.uiMidi(cc(n, v));
            await this.tx.frames(2);
            await this.tx.uiMidi(cc(n, 0));
        },
        note: async (n: number, v = 100) => {
            await this.tx.uiMidi(noteOn(n, v));
            await this.tx.frames(2);
            await this.tx.uiMidi(noteOff(n));
        },
        knob: async (k: number, delta: number) =>
            this.tx.uiMidi(cc(CC_KNOB_BASE + k, knobDelta(delta))),
        jog: async () => this.tap.cc(CC_JOG_CLICK),
        jogTurn: async (dir: 1 | -1) => this.tx.uiMidi(cc(CC_JOG_TURN, dir > 0 ? 1 : 127)),
    };

    /* note-on, body, note-off — a real hold, with the body free to inject other
     * events inside it. This is how "hold a step and turn a knob" is expressed.
     * Under the old harness each inject was its own ~500 ms ssh round trip, so a
     * press/release pair WAS a half-second hold and movy read it as a different
     * gesture entirely. */
    async hold(note: number, body: () => Promise<unknown>): Promise<void> {
        await this.tx.uiMidi(noteOn(note, 127));
        try { await body(); } finally { await this.tx.uiMidi(noteOff(note)); }
    }

    /* A CC HOLD — the same gesture as hold(), for a button that is a control
     * change rather than a note. The track buttons (CC 40-43) are CCs, and
     * holding one IS the gesture the track-volume fader is built on: the divert
     * is armed on the PRESS and torn down on the release (track-volume.ts), so a
     * tap of the button leaves `heldTrack` at -1 and the turn falls through to
     * Move's own master volume. */
    async holdCc(n: number, body: () => Promise<unknown>): Promise<void> {
        await this.tx.uiMidi(cc(n, 127));
        try { await body(); } finally { await this.tx.uiMidi(cc(n, 0)); }
    }

    /* A knob HOLD — the gesture hold() above cannot express.
     *
     * BOTH edges of a knob touch are note-ON (0x90) on note 0..7: d2 > 0 presses,
     * d2 = 0 releases. `src/midi/router.ts` takes the whole knob branch under
     * `(status & 0xF0) === 0x90 && d1 < 8`, so a real note-off (0x80) is dropped
     * silently — movy never sees the release, and a picker that an item selector
     * opens on touch is never committed. The hold would look like a hang. */
    async knobHold(k: number, body: () => Promise<unknown>): Promise<void> {
        await this.tx.uiMidi(noteOn(k, 127));
        try { await body(); } finally { await this.tx.uiMidi(noteOn(k, 0)); }
    }

    /* Opening is the host's launch gate and then SILENCE.
     *
     * The launch gate says the module is loaded. Movy then restores the set by
     * ferrying it through the engine param channel, which in overtake is a
     * SINGLE SLOT (the overtake_dsp param SHM) —
     * and touching that SHM while the restore runs does not merely slow it, it
     * STARVES it, the same way a poll loop starved the probe's own replies.
     *
     * Measured: an automation registry that came back EMPTY on about half of
     * reopens, from a blob that demonstrably held both lanes (au=2 on disk).
     * A probe-driven "session ready" gate here made it worse, because the gate
     * is itself param traffic — the very thing the restore cannot share. It was
     * added on a hypothesis that proved wrong (the track was right all along)
     * and is gone rather than worked around.
     *
     * So: wait, silently. WAIT_FRAME touches no param. The probe argument is
     * accepted and unused, so callers need not care which gates exist. */
    async open(_probe?: Probe): Promise<void> {
        const before = await this.readyLineCount();
        await this.tx.launch();
        /* Wait for movy's own "set ready" line, read over SSH — deliberately
         * OUT OF BAND. Every param read would compete with the restore it is
         * waiting for; the log does not. Falls back to the quiet window if the
         * device log is off, so this degrades rather than breaks. */
        try {
            await until(this.tx, 'movy to report the set ready',
                () => this.readyLineCount(), (n) => n > before,
                { within: 5000, every: 150 });
        } catch {
            await this.tx.frames(RESTORE_QUIET);
        }
        /* After the restore, never during it — see applyRunMute. */
        await applyRunMute(this.tx);
    }

    /* How many times movy has logged `seq: set ready` (set-session.ts). */
    private async readyLineCount(): Promise<number> {
        return (await this.logLines('seq: set ready')).length;
    }

    /* Lines matching `pattern` in the device's unified log, read out of band
     * over SSH — for signals with no ViewModel to read: a restore in
     * progress, or what fires during unload as the DSP tears down and no
     * probe answers on the way out. Swallows a failed read as no lines, as it
     * always has; the fixture, which cannot afford that, calls logGrep. */
    logLines(pattern: string): Promise<string[]> { return this.tx.logGrep(pattern).catch(() => []); }

    /* One SHM write, no gesture. Verified on device: overtake_mode 2 -> 0,
     * logging "suspendOvertakeMode: suspend_keeps_js — parking movy in
     * background". The DSP stays loaded — this is a park, not a close. */
    async park(): Promise<void> {
        await this.needMove().park();
        await this.waitParked(1400);
    }

    /* Park by the USER'S door rather than the host flag above: Back at the root
     * opens the Leave modal, whose DEFAULT selection is Background (the router
     * maps it to host_suspend_overtake). Both routes land in the same state, but
     * only this one also exercises the modal — and the modal is what a park has
     * to survive, since Background is the option that exists only while
     * host_suspend_overtake does. */
    async parkViaModal(probe: Probe): Promise<void> {
        this.needMove();
        await this.leaveVia(probe, 'Background');
    }

    async unpark(probe?: Probe): Promise<void> { await this.open(probe); }

    private async waitParked(within: number): Promise<void> {
        await until(this.tx, 'movy to park',
            () => this.tx.running(), (up) => !up, { within });
    }

    /* A FULL close, which unloads the DSP — not the same thing as park().
     *
     * Back is not a close button: at the root it opens the Leave modal, while
     * the modal is up it DISMISSES it, and anywhere else it navigates up one
     * level — and before any of that it descends schwung's own layer ladder
     * (hint, enum peek, section picker, entered menu). There is no Shift+Back
     * variant. So a fixed number of Backs is ambiguous by parity: `Back x3`,
     * which every bash suite used, can open-dismiss-open the modal and never
     * exit. test-auto.sh's "reopen fresh" steps never actually closed movy.
     *
     * Closed-loop off the probe instead: press Back until the modal is up, jog
     * to the wanted label, confirm. */
    async close(probe: Probe): Promise<void> { await this.leaveVia(probe, 'Close Movy'); }

    /* Shared by close() and parkViaModal() — the same modal, different label.
     * parkViaModal is a PARK (DSP stays loaded, init() not re-run) so it lands
     * on the same wait; close is a full unload, but the host drops overtake_mode
     * either way, so one wait covers both. */
    private async leaveVia(probe: Probe, want: string): Promise<void> {
        for (let i = 0; i < 6; i++) {
            const st = await probe.ask({ key: 'leave' });
            if (st.active) break;
            await this.tap.cc(CC_BACK);
            await this.tx.frames(20);
        }
        for (let i = 0; i < 4; i++) {
            const st = await probe.ask({ key: 'leave' });
            if (!st.active) break;
            if (st.label === want) { await this.tap.cc(CC_JOG_CLICK); break; }
            await this.tap.jogTurn(1);
            await this.tx.frames(20);
        }
        await this.waitParked(2000);
    }

    async reopen(probe: Probe): Promise<void> { await this.close(probe); await this.open(probe); }

    /* Taps a TRACK BUTTON, which is group-relative: there are only four, and
     * they address the focused group of four. So this is correct ONLY while
     * that group is 0, and lands somewhere else silently otherwise — measured
     * 2026-09-12, with the focus on track 9, selectTrack(2) selected track 10.
     *
     * Every shipped scenario but one asks for track 0 from a fresh open, so
     * none of them can see it. `scenarios/seq.ts` is the caller that moves the
     * focus (hold-Session + step 9) and then keeps calling this; its `goTrack`
     * verifies the engine's `trk=` and falls back to the Session step row,
     * which addresses all sixteen absolutely. That fallback belongs there
     * rather than here because it is a different gesture with side effects of
     * its own (captureClear, releaseAllLive — src/seq/router-buttons.ts), not a
     * drop-in replacement for a button press. */
    async selectTrack(n: number): Promise<void> {
        await this.tap.cc(CC_TRACK_BASE + (3 - (n % 4)));
        await this.tx.frames(30);
    }

    /* Kept as the scenarios' call site; the work and the once-per-sweep rule
     * live in engine.ts next to deployEngine, because the ordering that matters
     * (ui.js on the device BEFORE the first open, not after the fixture) is a
     * property of the sweep rather than of any one scenario. */
    async deployUi(): Promise<void> { await this.tx.deployUi(); }

    async restartStack(): Promise<void> { await this.tx.restart(); }

    /* Engine params, UNPREFIXED — the host's namespace is the transport's. */
    readonly param = {
        get: (key: string) => this.tx.engineGet(key),
        set: (key: string, v: string) => this.tx.engineSet(key, v),
    };

    /* The coexistence door, for scenarios that declared `needs: 'move'`. One
     * that reaches it without declaring fails here, by name, rather than
     * hanging on a park that a host without Background never performs. */
    private needMove() {
        if (!this.tx.move) throw new Error(`park needs Move beside movy; the ${this.tx.flavour} flavour has none — declare needs: 'move'`);
        return this.tx.move;
    }
}
