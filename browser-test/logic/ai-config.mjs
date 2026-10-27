/* browser-test/logic/ai-config.mjs — AI MIDI settings: which Gemini model
 * and the key from Schwung's per-module secrets/ (design §6.1).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, installMockFs, uninstallMockFs } from './harness.mjs';
import { readAiConfig, modelChain, PRIMARY_MODEL, FALLBACK_MODEL } from '../../dist/esm/ai/index.js';
import { standalonePlatform } from '../../dist/esm/platform/standalone.js';

const DIR = '/m';

export async function run() {
_log('\nTest: AI config');

installMockFs({ [DIR + '/secrets/gemini_api_key.txt']: 'AIzaKEY\n' });
let c = readAiConfig(DIR);
eq('ai_config_reads_gemini_key: key trimmed', c && c.key, 'AIzaKEY');
/* gemini-2.5-flash answers 404 "no longer available to new users" (live
 * check 2026-10-27): the defaults come from the bench, and the fallback is
 * an alias that follows Google's current Lite model. */
eq('model_chain_default: the bench pick, then the fast fallback', JSON.stringify(modelChain(c)), JSON.stringify([PRIMARY_MODEL, FALLBACK_MODEL]));
eq('fallback is the live Lite alias', FALLBACK_MODEL, 'gemini-flash-lite-latest');
uninstallMockFs();

/* A config.json written while OpenAI was still offered must not lose the key. */
installMockFs({ [DIR + '/config.json']: JSON.stringify({ provider: 'openai' }),
    [DIR + '/secrets/gemini_api_key.txt']: 'AIzaKEY' });
eq('ai_config_gemini_only: a stale provider is ignored', readAiConfig(DIR)?.key, 'AIzaKEY');
uninstallMockFs();

installMockFs({ [DIR + '/config.json']: JSON.stringify({ model: 'gemma-x' }), [DIR + '/secrets/gemini_api_key.txt']: 'k' });
eq('model_field_replaces_primary_keeps_fallback', JSON.stringify(modelChain(readAiConfig(DIR))), JSON.stringify(['gemma-x', FALLBACK_MODEL]));
installMockFs({ [DIR + '/config.json']: JSON.stringify({ model: FALLBACK_MODEL }), [DIR + '/secrets/gemini_api_key.txt']: 'k' });
eq('a chain never asks the same model twice', JSON.stringify(modelChain(readAiConfig(DIR))), JSON.stringify([FALLBACK_MODEL]));
uninstallMockFs(); uninstallMockFs();
installMockFs({ [DIR + '/config.json']: JSON.stringify({ model: 'gemini-2.5-flash-lite' }),
    [DIR + '/secrets/gemini_api_key.txt']: '  \n' });
eq('ai_config_ignores_whitespace_key', readAiConfig(DIR), null);
installMockFs({ [DIR + '/config.json']: '{not json', [DIR + '/secrets/gemini_api_key.txt']: 'k' });
c = readAiConfig(DIR);
eq('ai_config_bad_json_falls_back_to_defaults', JSON.stringify(modelChain(c)), JSON.stringify([PRIMARY_MODEL, FALLBACK_MODEL]));
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
