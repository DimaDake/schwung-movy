/* Which Gemini models answer, in order (design §5b): the bench's pick first,
 * then the fast Lite alias when the first is busy (429/503) or silent past
 * its wait. Picks and waits come from plans/gen-bench-results-*.md. */

import type { AiConfig } from './config.js';
import { HTTP_TIMEOUT_S } from './http-job.js';
import type { AiStatus } from './provider.js';

export const PRIMARY_MODEL = 'gemini-3.1-flash-lite';
export const FALLBACK_MODEL = 'gemini-flash-lite-latest';

/* The first model's wait: past it the fallback is asked. Kept short enough
 * that both waits together stay well inside what a person waits at a box. */
export const FIRST_TIMEOUT_S = 40;

/** The web page's Model field, when set, replaces the first model only. */
export function modelChain(cfg: AiConfig): string[] {
    const first = cfg.model ?? PRIMARY_MODEL;
    return first === FALLBACK_MODEL ? [first] : [first, FALLBACK_MODEL];
}

export function timeoutFor(index: number, count: number): number {
    return index < count - 1 ? FIRST_TIMEOUT_S : HTTP_TIMEOUT_S;
}

/** Busy or silent: worth asking the next model. An answer is never retried,
 *  except a 404 from a model the user did not type: Google retires models
 *  (gemini-2.5-flash answered 404 to new keys), and the Lite alias survives. */
export function worthFallback(status: AiStatus, http: number, typedByUser: boolean): boolean {
    return status === 'BUSY, TRY LATER' || (http === 404 && !typedByUser);
}
