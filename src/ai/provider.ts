/* Gemini and OpenAI as plain request/response shapes (design §6.2). Both are
 * asked for JSON output; the text they return goes to validate.ts. */

import type { AiConfig, AiProvider } from './config.js';

export interface AiHttpRequest { url: string; headers: string[]; body: string }

export type AiStatus = 'ok' | 'NO NETWORK' | 'AI BUSY, TRY LATER' | 'AI ERROR';

export function buildRequest(cfg: AiConfig, p: { system: string; user: string }): AiHttpRequest {
    if (cfg.provider === 'openai') {
        return {
            url: 'https://api.openai.com/v1/chat/completions',
            headers: ['Content-Type: application/json', 'Authorization: Bearer ' + cfg.key],
            body: JSON.stringify({
                model: cfg.model,
                messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
                response_format: { type: 'json_object' },
                temperature: 1,
            }),
        };
    }
    return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
        headers: ['Content-Type: application/json', 'x-goog-api-key: ' + cfg.key],
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: p.system }] },
            contents: [{ role: 'user', parts: [{ text: p.user }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 1.0 },
        }),
    };
}

/** The model's text, or null when the body is not a completion. */
export function extractText(provider: AiProvider, body: string): string | null {
    try {
        const v = JSON.parse(body);
        if (provider === 'openai') {
            const t = v?.choices?.[0]?.message?.content;
            return typeof t === 'string' ? t : null;
        }
        const parts = v?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return null;
        return parts.map((x: { text?: string }) => x?.text ?? '').join('');
    } catch {
        return null;
    }
}

/* curl failing at all (DNS, connect, TLS, timeout) means the box could not
 * reach the service; 429/503 are the free tier's quota and overload answers. */
export function classifyStatus(http: number, curlExit: number): AiStatus {
    if (curlExit !== 0) return 'NO NETWORK';
    if (http >= 200 && http < 300) return 'ok';
    if (http === 429 || http === 503) return 'AI BUSY, TRY LATER';
    return 'AI ERROR';
}
