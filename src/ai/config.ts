/* AI MIDI settings (design §6.1). Schwung's web UI writes them into movy's own
 * module dir: plain values in config.json, password fields as
 * secrets/<key>.txt, which never travel back to the browser. Read per request,
 * not cached: the user may paste a key while movy is open. */

import { platform } from '../platform/index.js';

export interface AiConfig {
    model: string | null;     // the web page's Model field; null = the bench's pick (models.ts)
    key: string;
}

function readJson(path: string): Record<string, unknown> {
    try {
        const v = JSON.parse(platform.readFile(path) ?? '{}');
        return v && typeof v === 'object' ? v as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

/** null = no key (the caller shows NO API KEY). */
export function readAiConfig(moduleDir: string): AiConfig | null {
    const cfg = readJson(moduleDir + '/config.json');
    const key = (platform.readFile(moduleDir + '/secrets/gemini_api_key.txt') ?? '').trim();
    if (!key) return null;
    const model = typeof cfg.model === 'string' && cfg.model.trim() ? cfg.model.trim() : null;
    return { model, key };
}
