/* Gemini as a plain request/response shape (design §6.2). It is asked for
 * JSON output; the text it returns goes to validate.ts. */

import type { AiConfig } from './config.js';

export interface AiHttpRequest { url: string; headers: string[]; body: string }

export type AiStatus = 'ok' | 'NO NETWORK' | 'BUSY, TRY LATER' | 'GENERATOR ERROR';

export function buildRequest(cfg: AiConfig, p: { system: string; user: string }, temperature = 1.0): AiHttpRequest {
    return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
        headers: ['Content-Type: application/json', 'x-goog-api-key: ' + cfg.key],
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: p.system }] },
            contents: [{ role: 'user', parts: [{ text: p.user }] }],
            generationConfig: { responseMimeType: 'application/json', temperature },
        }),
    };
}

/** The model's text, or null when the body is not a completion. */
export function extractText(body: string): string | null {
    try {
        const parts = JSON.parse(body)?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return null;
        return parts.map((x: { text?: string }) => x?.text ?? '').join('');
    } catch {
        return null;
    }
}

/* 429/503 are the free tier's quota and overload answers. An overloaded model
 * can also hold the connection silently past curl's timeout (exit 28): the
 * network was fine then. Any other curl failure (DNS, connect, TLS) is ours. */
const CURL_TIMEOUT = 28;

export function classifyStatus(http: number, curlExit: number): AiStatus {
    if (curlExit === CURL_TIMEOUT) return 'BUSY, TRY LATER';
    if (curlExit !== 0) return 'NO NETWORK';
    if (http >= 200 && http < 300) return 'ok';
    if (http === 429 || http === 503) return 'BUSY, TRY LATER';
    return 'GENERATOR ERROR';
}
