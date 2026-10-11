import type { BusEvent, LogTail } from './bus.js';
import type { Packet } from './midi.js';
import type { EngineDeploy } from './engine.js';

/* What a scenario may require of the device beyond movy itself: movy-host's
 * own bus verbs (log ring, midi_out tap, UI_EVAL — absent from a release
 * build), and the volume knob and power button as movy's own. A transport
 * without one prints the scenario N/A instead of grading it. */
export type Need = 'testbus' | 'master-volume' | 'power-button';

export type Flavour = 'standalone';

/* movy-host's own test-bus verbs (docs/standalone/testbus.md "New"), null on
 * a flavour without them. Reached as `tx.hostBus!` by a scenario that
 * declared `needs: 'testbus'`. */
export interface HostBus {
    logSeq(): Promise<number>;
    logTail(from: number, pattern?: string): Promise<LogTail>;
    subscribeMidiOut(): Promise<void>;
    dumpMidiOut(): Promise<BusEvent[]>;
    uiEval(js: string): Promise<unknown>;
    /* movy-host's STATE (testbus.md, STATE keys), numbers only. */
    state(): Promise<Record<string, number>>;
    /* Dev builds only: SIGSEGV movy-host, to prove the backtrace path. */
    crash(): Promise<void>;
}

/* The device as the scenarios see it: movy-host's own test bus
 * (docs/standalone/testbus.md). An interface, not the class, so the selftests
 * can stand in a fake.
 *
 * Engine keys are UNPREFIXED (`status`, `ch0:mix`).
 *
 * Plain ssh to the box (fixture files, `cat` of a saved Set) is not here. */
export interface Transport {
    readonly flavour: Flavour;
    readonly host: string;
    has(need: Need): boolean;
    readonly hostBus: HostBus | null;

    connect(): Promise<void>;
    close(): Promise<void>;
    /* The bus's own banner — answers while movy is down, so it is the probe
     * for "the host is back" after a restart. */
    ping(): Promise<string>;

    /* Blocks ON THE DEVICE until n audio frames (~2.9 ms each) have passed. */
    frames(n: number): Promise<number>;

    /* A packet movy's UI receives as surface input (onMidiMessageInternal). */
    uiMidi(p: Packet): Promise<void>;
    /* A packet into the hardware MIDI_IN the DSP side reads. Overtake: the
     * shim's inject ring, which reaches Move and never movy's UI. Standalone:
     * the same as uiMidi — movy-host feeds one input to both. */
    dspMidi(p: Packet): Promise<void>;

    /* The fast engine param channel. Overtake: a SINGLE shared SHM slot, so
     * pollers must keep PARAM_POLL_GAP (wait.ts). */
    engineGet(key: string): Promise<string>;
    engineSet(key: string, value: string): Promise<void>;
    /* A write that is queued rather than slotted, for loads and pokes that
     * must not be dropped. Write-only. */
    engineSetQueued(key: string, value: string): Promise<void>;

    padLeds(): Promise<Uint8Array>;
    /* The 128x64 1bpp framebuffer, 8 pages x 128 bytes (display.ts). */
    framebuffer(): Promise<Buffer>;
    /* Lines of the device's debug.log matching a fixed grep pattern. A read
     * that failed throws: it must never look like "no lines yet". */
    logGrep(pattern: string): Promise<string[]>;

    /* Start movy and return once its engine answers params. */
    launch(): Promise<void>;
    /* Movy owns the surface (overtake: overtake_mode == 2). */
    running(): Promise<boolean>;
    /* Restart whatever hosts the engine, so a redeployed dsp.so is the one
     * running, and return once the bus answers again. */
    restart(): Promise<void>;
    deployEngine(): Promise<EngineDeploy>;
    deployUi(force?: boolean): Promise<boolean>;
}
