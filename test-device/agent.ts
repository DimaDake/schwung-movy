import { LineClient } from './line-client.js';
import { hex, type Packet } from './midi.js';

/* Client for movy's own device-side agent (test-device/device-agent/ui-agent.py).
 *
 * It owns the ONE thing schwung-testd cannot do: write /dev/shm/schwung-ui-midi,
 * the ring shadow_ui drains into onMidiMessageInternal. Every movy gesture goes
 * through here. */
export class Agent {
    private c: LineClient;
    constructor(host: string, port = 47778) { this.c = new LineClient(host, port, 'ui-agent'); }

    connect(): Promise<void> { return this.c.connect(); }
    close(): void { this.c.close(); }

    async ping(): Promise<string> { return (await this.c.send('PING')).slice(3); }
    async inject(p: Packet): Promise<void> { await this.c.send(`UI ${hex(p)}`); }

    /* shadow_control_t byte 7 (offUIFlags) |= n. 0x80 is
     * SHADOW_UI_FLAG_JUMP_TO_TOOLS, which parks a self-managed overtake module
     * — verified on device: overtake_mode 2 -> 0 in one write, the DSP staying
     * loaded. That is a park, not a close. */
    async uiFlag(n: number): Promise<void> { await this.c.send(`FLAG ${n}`); }
}

export const UI_FLAG_JUMP_TO_TOOLS = 0x80;
