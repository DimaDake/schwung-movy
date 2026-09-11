import { LineClient } from './line-client.js';
import { hex, type Packet } from './midi.js';

export type BusEvent = { frame: number; bytes: number[] };

/* Client for schwung-testd, the on-device test bus that ships with schwung.
 *
 * What it gives movy: a real frame clock (WAIT_FRAME), shim state, and a param
 * bridge into the overtake DSP — i.e. movy's Rust engine, which already answers
 * status/diag/cmd. What it does NOT give: UI gestures. Its INJECT_MIDI writes
 * the shim's ring into Move's MIDI_IN, which never reaches an overtake module's
 * UI (measured 2026-09-11). That is the Agent's job. */
export class Bus {
    private c: LineClient;
    constructor(host: string, port = 47777) { this.c = new LineClient(host, port, 'testd'); }

    connect(): Promise<void> { return this.c.connect(); }
    close(): void { this.c.close(); }
    send(line: string): Promise<string> { return this.c.send(line); }

    async ping(): Promise<string> { return (await this.c.send('PING')).slice(3); }

    async state(): Promise<Record<string, number>> {
        const r = (await this.c.send('STATE')).slice(3);
        const out: Record<string, number> = {};
        for (const kv of r.split(/\s+/)) {
            const eq = kv.indexOf('=');
            if (eq > 0) out[kv.slice(0, eq)] = Number(kv.slice(eq + 1));
        }
        return out;
    }

    /* Blocks on the DEVICE until the shim's SPI frame counter advances by n.
     * A frame is ~2.9 ms, so this is a quantity of device work, not dev-machine
     * time — it does not drift when the device is loaded. */
    async frames(n: number): Promise<number> {
        const r = await this.c.send(`WAIT_FRAME ${n}`);
        return Number(r.replace(/^OK frame=/, ''));
    }

    async getParam(key: string): Promise<string> { return (await this.c.send(`GET_PARAM ${key}`)).slice(3); }
    async setParam(key: string, v: string): Promise<void> { await this.c.send(`SET_PARAM ${key} ${v}`); }
    async openTool(id: string): Promise<void> { await this.c.send(`SET_OPEN_TOOL ${id}`); }
    async restartMove(): Promise<void> { await this.c.send('RESTART_MOVE'); }
    async injectShim(p: Packet): Promise<void> { await this.c.send(`INJECT_MIDI ${hex(p)}`); }

    async padLeds(): Promise<Uint8Array> {
        const r = (await this.c.send('SNAPSHOT_PAD_LEDS')).slice(3).trim();
        const out = new Uint8Array(r.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(r.slice(i * 2, i * 2 + 2), 16);
        return out;
    }

    async subscribe(ch: string): Promise<void> { await this.c.send(`SUBSCRIBE ${ch}`); }
    async unsubscribe(ch: string): Promise<void> { await this.c.send(`UNSUBSCRIBE ${ch}`); }

    async dump(ch: string): Promise<BusEvent[]> {
        const lines = await this.c.sendMulti(`DUMP ${ch}`);
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
