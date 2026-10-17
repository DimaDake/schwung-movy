/* Driving the Sets page (Shift + Step 1) the way a user does — shared by the
 * scenarios that need to be in a particular library Set. */

import type { Transport } from './transport.js';
import type { Device } from './device.js';
import type { Probe } from './probe.js';
import { until } from './wait.js';
import { cc, CC_JOG_TURN, STEP_NOTE_BASE } from './midi.js';
import { readLib, type Lib } from './lib-wire.js';

export const CC_SHIFT = 49;
export const WAIT = { within: 10000, every: 200 };

export type SetsView = { view: string; selected: number; confirming: boolean; keyboard: boolean; buffer: string | null };

export function setsNav(tx: Transport, dev: Device, probe: Probe) {
    const lib = (): Promise<Lib> => readLib(tx.hostBus!);
    const libUntil = (what: string, pred: (l: Lib) => boolean) => until(tx, what, lib, pred, WAIT);
    const sets = async () => await probe.ask({ key: 'sets' }) as SetsView;
    const ready = () => until(tx, 'the Set to be live', () => probe.tick(), (v: any) => v.ready, { within: 20000, every: 300 });
    const openPage = async () => {
        await dev.holdCc(CC_SHIFT, () => dev.tap.note(STEP_NOTE_BASE));
        await until(tx, 'the Sets page', sets, (s) => s.view === 'sets', WAIT);
    };
    /* The whole move in ONE packet, the way movy-host delivers a fast spin
     * (host/deltas.c sums a tick's detents): a list that read only the sign
     * moved one row per spin, and this is what caught it. */
    const cursorTo = async (row: number) => {
        const d = Math.max(-63, Math.min(63, row - (await sets()).selected));
        if (d !== 0) await tx.uiMidi(cc(CC_JOG_TURN, d > 0 ? d : 128 + d));
        await until(tx, `the cursor on row ${row}`, sets, (v) => v.selected === row, WAIT);
    };
    const rowOf = async (id: string) => (await lib()).rows.findIndex((r) => r.id === id) + 1;
    /** Open library Set `id` from the page and wait until it is live. */
    const openSet = async (id: string) => {
        await openPage();
        await cursorTo(await rowOf(id));
        await dev.tap.jog();
        await libUntil(`Set ${id} open`, (l) => l.cur === id);
        await ready();
    };
    return { lib, libUntil, sets, ready, openPage, cursorTo, rowOf, openSet };
}
