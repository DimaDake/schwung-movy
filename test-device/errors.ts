/* What broke: the pipe, or the device's answer.
 *
 * The tier retries both, but not the same way — an ssh that died mid-command
 * says nothing about movy, while a value that never arrived is exactly how a
 * real regression presents. Retrying the second one until it goes green is how
 * a suite stops being a gate, so the two need telling apart. */

/* The connection itself failed: no reply, or no socket to reply on. Distinct
 * from an `ERR` line, which IS an answer — the device understood the command
 * and refused it, and that is a result, not a dropped call. */
export class TransportError extends Error {
    constructor(msg: string) { super(msg); this.name = 'TransportError'; }
}

/* ssh reserves exit 255 for its OWN failures — connect refused, host key,
 * connection reset mid-stream. A remote command's status passes through
 * unchanged, so 255 on an `ssh`/`scp` invocation means the transport, not the
 * thing we asked for. */
function isSshTransportFailure(e: { cmd?: unknown; code?: unknown }): boolean {
    const cmd = typeof e.cmd === 'string' ? e.cmd : '';
    return /^(ssh|scp)\b/.test(cmd) && e.code === 255;
}

const SOCKET_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT',
                              'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND']);

export function isInfraError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err instanceof TransportError) return true;
    const e = err as Error & { cmd?: unknown; code?: unknown };
    if (typeof e.code === 'string' && SOCKET_CODES.has(e.code)) return true;
    return isSshTransportFailure(e);
}
