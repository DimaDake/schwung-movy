import net from 'node:net';
import { TransportError } from './errors.js';

/* Both device servers (schwung-testd and movy's ui-agent) speak the same shape:
 * line-based ASCII, one command per line, replies starting OK or ERR. One
 * persistent connection per server for a whole run — testd's contract is one
 * client at a time, and reconnecting per command would drop its subscriptions. */
export class LineClient {
    private sock: net.Socket | null = null;
    private buf = '';
    private queue: Array<{ multi: boolean; resolve: (v: any) => void;
                           reject: (e: Error) => void; lines: string[] }> = [];

    constructor(private host: string, private port: number, private what: string) {}

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const s = net.createConnection({ host: this.host, port: this.port });
            /* The only wall-clock timeout in test-device/: a TCP connect has no
             * frame clock to wait on, because a device that never answers has
             * no frames to count. */
            s.setTimeout(10_000, () => {
                s.destroy();
                reject(new TransportError(`${this.what}: connect timeout ${this.host}:${this.port}`));
            });
            s.once('connect', () => { s.setTimeout(0); this.sock = s; resolve(); });
            s.once('error', reject);
            s.on('data', (d) => this.onData(d.toString('utf8')));
            /* A connection that dies mid-run used to hang the sweep: every
             * queued command was waiting on a reply that could no longer come,
             * and nothing in the harness times a command out. Failing the
             * waiters instead turns a dropped link into an infra error the
             * runner can retry. */
            s.once('close', () => this.fail(new TransportError(`${this.what}: connection closed`)));
        });
    }

    /* Reject everything still in flight. The socket is gone, so no reply is
     * coming for any of them. */
    private fail(err: TransportError): void {
        if (this.sock) this.sock = null;
        const q = this.queue;
        this.queue = [];
        for (const w of q) w.reject(err);
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

    private settle(w: { resolve: (v: any) => void; reject: (e: Error) => void; multi: boolean },
                   lines: string[]): void {
        const first = lines[0] ?? '';
        if (first.startsWith('ERR')) { w.reject(new Error(`${this.what}: ${first}`)); return; }
        w.resolve(w.multi ? lines : first);
    }

    private write(line: string, multi: boolean): Promise<any> {
        if (!this.sock) return Promise.reject(new TransportError(`${this.what}: not connected`));
        return new Promise((resolve, reject) => {
            this.queue.push({ multi, resolve, reject, lines: [] });
            this.sock!.write(line + '\n');
        });
    }

    send(line: string): Promise<string> { return this.write(line, false); }
    sendMulti(line: string): Promise<string[]> { return this.write(line, true); }
    close(): void { this.sock?.end(); this.sock = null; }
}
