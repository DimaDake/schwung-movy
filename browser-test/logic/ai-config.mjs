/* browser-test/logic/ai-config.mjs — AI MIDI settings: which provider, which
 * model, and the key from Schwung's per-module secrets/ (design §6.1).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, installMockFs, uninstallMockFs } from './harness.mjs';
import { readAiConfig } from '../../dist/esm/ai/index.js';
import { standalonePlatform } from '../../dist/esm/platform/standalone.js';

const DIR = '/m';

export async function run() {
_log('\nTest: AI config');

installMockFs({ [DIR + '/secrets/gemini_api_key.txt']: 'AIzaKEY\n' });
let c = readAiConfig(DIR);
eq('ai_config_reads_gemini_key: provider defaults to gemini', c && c.provider, 'gemini');
eq('ai_config_reads_gemini_key: key trimmed', c && c.key, 'AIzaKEY');
eq('ai_config_reads_gemini_key: default model', c && c.model, 'gemini-2.5-flash');
uninstallMockFs();

installMockFs({ [DIR + '/config.json']: JSON.stringify({ provider: 'openai' }),
    [DIR + '/secrets/gemini_api_key.txt']: 'AIzaKEY' });
eq('ai_config_null_without_key: openai chosen, only a gemini key', readAiConfig(DIR), null);
uninstallMockFs();

installMockFs({ [DIR + '/config.json']: JSON.stringify({ provider: 'openai', model: 'gemini-2.5-flash' }),
    [DIR + '/secrets/openai_api_key.txt']: 'sk-1' });
c = readAiConfig(DIR);
eq('ai_config_openai_default_model: gemini default swapped', c && c.model, 'gpt-4.1-mini');
uninstallMockFs();

installMockFs({ [DIR + '/config.json']: JSON.stringify({ model: 'gemini-2.5-flash-lite' }),
    [DIR + '/secrets/gemini_api_key.txt']: '  \n' });
eq('ai_config_ignores_whitespace_key', readAiConfig(DIR), null);
installMockFs({ [DIR + '/config.json']: '{not json', [DIR + '/secrets/gemini_api_key.txt']: 'k' });
c = readAiConfig(DIR);
eq('ai_config_bad_json_falls_back_to_defaults', c && c.model, 'gemini-2.5-flash');
uninstallMockFs(); uninstallMockFs();

/* The HTTP seam: movy-host's global takes Schwung's snake_case option names. */
let got = null;
globalThis.host_http_request_background = (o) => { got = o; return true; };
const okStart = standalonePlatform.httpStart({ url: 'https://x', method: 'POST', headers: ['a: b'],
    bodyPath: '/b', responsePath: '/r', statusPath: '/s', timeoutS: 60 });
eq('http_start_maps_options: returns the host answer', okStart, true);
eq('http_start_maps_options: snake_case keys', got && [got.url, got.method, got.headers[0], got.body_path,
    got.response_path, got.status_path, got.timeout_seconds].join('|'), 'https://x|POST|a: b|/b|/r|/s|60');
delete globalThis.host_http_request_background;
}
