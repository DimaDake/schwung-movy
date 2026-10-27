/* browser-test/logic/ai-provider.mjs — request shapes for Gemini/OpenAI,
 * reading their replies, and the background HTTP job (design §6.2).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockFs, uninstallMockFs } from './harness.mjs';
import { buildRequest, extractText, classifyStatus, startHttp, pollHttp, cancelHttp, AI_DIR }
    from '../../dist/esm/ai/index.js';

const P = { system: 'SYS', user: 'USER' };
const MOD = '/m';

export async function run() {
_log('\nTest: AI provider');

const g = buildRequest({ provider: 'gemini', model: 'gemini-2.5-flash', key: 'K' }, P);
eq('gemini_request_shape: url', g.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
ok('gemini_request_shape: key header', g.headers.includes('x-goog-api-key: K'));
const gb = JSON.parse(g.body);
eq('gemini_request_shape: system', gb.systemInstruction.parts[0].text, 'SYS');
eq('gemini_request_shape: user', gb.contents[0].parts[0].text, 'USER');
eq('gemini_request_shape: json mode', gb.generationConfig.responseMimeType, 'application/json');

const o = buildRequest({ provider: 'openai', model: 'gpt-4.1-mini', key: 'S' }, P);
eq('openai_request_shape: url', o.url, 'https://api.openai.com/v1/chat/completions');
ok('openai_request_shape: bearer', o.headers.includes('Authorization: Bearer S'));
const ob = JSON.parse(o.body);
eq('openai_request_shape: messages', ob.messages.map((m) => m.role + ':' + m.content).join('|'), 'system:SYS|user:USER');
eq('openai_request_shape: json mode', ob.response_format.type, 'json_object');

eq('extract_text_gemini', extractText('gemini', JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a"' }, { text: ':1}' }] } }] })), '{"a":1}');
eq('extract_text_openai', extractText('openai', JSON.stringify({ choices: [{ message: { content: 'X' } }] })), 'X');
eq('extract_text: garbage -> null', extractText('gemini', '<html>'), null);

eq('classify_ok', classifyStatus(200, 0), 'ok');
eq('classify_429_busy', classifyStatus(429, 0), 'AI BUSY, TRY LATER');
eq('classify_503_busy', classifyStatus(503, 0), 'AI BUSY, TRY LATER');
eq('classify_curl_timeout_network', classifyStatus(0, 28), 'NO NETWORK');
eq('classify_400_error', classifyStatus(400, 0), 'AI ERROR');

/* The job: a status file is the only "done" signal. */
const fs = installMockFs();
let sent = null;
globalThis.host_http_request_background = (opts) => { sent = opts; return true; };
const id = startHttp({ url: 'https://x', headers: ['h: 1'], body: 'BODY' }, MOD);
ok('start writes the body under /data/UserData', sent && sent.body_path.startsWith(AI_DIR) && fs.files[sent.body_path] === 'BODY');
eq('poll_null_until_status_file', pollHttp(id), null);
fs.files[sent.response_path] = 'RESP';
fs.files[sent.status_path] = '{"http_status":200,"curl_exit":0}';
eq('poll returns the reply once the status lands', JSON.stringify(pollHttp(id)), '{"http":200,"curlExit":0,"body":"RESP"}');

const id2 = startHttp({ url: 'https://x', headers: [], body: 'B2' }, MOD);
cancelHttp(id2);
fs.files[sent.response_path] = 'LATE';
fs.files[sent.status_path] = '{"http_status":200,"curl_exit":0}';
eq('late_reply_after_cancel_ignored', pollHttp(id2), null);

sent = null;
fs.files[MOD + '/ai-fake-response.json'] = 'FAKE';
const id3 = startHttp({ url: 'https://x', headers: [], body: 'B3' }, MOD);
eq('fake_response_bypasses_host: no curl', sent, null);
eq('fake_response_bypasses_host: reply', pollHttp(id3)?.body, 'FAKE');
delete globalThis.host_http_request_background;
uninstallMockFs();
}
