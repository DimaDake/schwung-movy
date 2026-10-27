/* browser-test/logic/ai-provider.mjs — the Gemini request shape,
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

const g = buildRequest({ model: 'gemini-2.5-flash', key: 'K' }, P);
eq('gemini_request_shape: url', g.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
ok('gemini_request_shape: key header', g.headers.includes('x-goog-api-key: K'));
const gb = JSON.parse(g.body);
eq('gemini_request_shape: system', gb.systemInstruction.parts[0].text, 'SYS');
eq('gemini_request_shape: user', gb.contents[0].parts[0].text, 'USER');
eq('gemini_request_shape: json mode', gb.generationConfig.responseMimeType, 'application/json');

eq('extract_text_gemini', extractText(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a"' }, { text: ':1}' }] } }] })), '{"a":1}');
eq('extract_text: garbage -> null', extractText('<html>'), null);

eq('classify_ok', classifyStatus(200, 0), 'ok');
eq('classify_429_busy', classifyStatus(429, 0), 'AI BUSY, TRY LATER');
eq('classify_503_busy', classifyStatus(503, 0), 'AI BUSY, TRY LATER');
/* An overloaded model can hold the connection open past curl's timeout
 * (live check: 240 s, no answer): the network was fine, the service was not. */
eq('classify_curl_timeout_busy', classifyStatus(0, 28), 'AI BUSY, TRY LATER');
eq('classify_curl_dns_network', classifyStatus(0, 6), 'NO NETWORK');
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
fs.files[MOD + '/ai-fake-response.json'] = '';
sent = null;
startHttp({ url: 'https://x', headers: [], body: 'B4' }, MOD);
ok('an emptied fake file is no fake (scenario cleanup)', sent !== null);
delete globalThis.host_http_request_background;
uninstallMockFs();
}
