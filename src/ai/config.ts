/* AI MIDI settings (design §6.1). Schwung's web UI writes them into movy's own
 * module dir: plain values in config.json, password fields as
 * secrets/<key>.txt, which never travel back to the browser. Read per request,
 * not cached: the user may paste a key while movy is open. */

import { platform } from '../platform/index.js';

export type AiProvider = 'gemini' | 'openai';

export interface AiConfig {
    provider: AiProvider;
    model: string;
    key: string;
}

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';

function readJson(path: string): Record<string, unknown> {
    try {
        const v = JSON.parse(platform.readFile(path) ?? '{}');
        return v && typeof v === 'object' ? v as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

/** null = no key for the chosen provider (the caller shows NO API KEY). */
export function readAiConfig(moduleDir: string): AiConfig | null {
    const cfg = readJson(moduleDir + '/config.json');
    const provider: AiProvider = cfg.provider === 'openai' ? 'openai' : 'gemini';
    const key = (platform.readFile(moduleDir + '/secrets/' + provider + '_api_key.txt') ?? '').trim();
    if (!key) return null;
    let model = typeof cfg.model === 'string' && cfg.model.trim() ? cfg.model.trim() : GEMINI_DEFAULT_MODEL;
    /* The schema has one model field defaulting to Gemini's; switching the
     * provider alone must not send a Gemini model name to OpenAI. */
    if (provider === 'openai' && model.startsWith('gemini')) model = OPENAI_DEFAULT_MODEL;
    return { provider, model, key };
}
