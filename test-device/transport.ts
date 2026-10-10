import type { Packet } from './midi.js';
import type { EngineDeploy } from './engine.js';

/* What a scenario may require of the device beyond movy itself. `move` is
 * Move running beside movy: Background, LINK, schwung's master FX slots, the
 * slot migration, the Move-volume divert. The standalone flavour retires all of
 * them (plan "Retired by design"), so a scenario that needs one declares it and
 * the runner prints it as N/A there instead of grading a feature that cannot
 * exist. */
export type Need = 'move';

export type Flavour = 'overtake' | 'standalone';

/* The coexistence-only operations, null on a flavour without Move. Kept apart
 * so that reaching for one is visible at the call site (`tx.move!`) and a
 * scenario that does so without declaring `needs: 'move'` fails loudly rather
 * than parking a host that has no Background. */
export interface MoveSide {
    /* Park movy under Move's UI (the Background door), DSP still loaded. */
    park(): Promise<void>;
}

/* The device as the scenarios see it: one implementation per flavour.
 * Overtake (transport-overtake.ts) is schwung-testd + ui-agent + scp; the
 * standalone flavour is movy-host's own test bus (docs/standalone/testbus.md).
 *
 * Engine keys are UNPREFIXED (`status`, `ch0:mix`): the overtake host's
 * `overtake_dsp:` namespace is a property of that host, not of the engine, and
 * movy-host has no such namespace.
 *
 * Plain ssh to the box (fixture files, `cat` of a saved Set) is not here: the
 * device and its filesystem are the same under both flavours. */
export interface Transport {
    readonly flavour: Flavour;
    readonly host: string;
    has(need: Need): boolean;
    readonly move: MoveSide | null;

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
