#!/usr/bin/env node
/* Wait until the store would actually OFFER a release, then post its
 * announcement to Discord.
 *
 * The tag is not the event worth announcing. A user's Move is offered whatever
 * `release.json` on the module's default branch says, so a release is live only
 * once the catalog carries the entry, that file advertises the new version, and
 * the asset it points at can really be downloaded. Announcing on the tag can
 * therefore tell people to update to something the store is not serving yet —
 * or, if the asset upload failed, will never serve.
 *
 * Dry run unless --post is given: it prints what it would send and exits. The
 * message is never composed here — it is docs/discord-v<version>.md, committed
 * and reviewed like anything else that goes out under the project's name.
 *
 * Usage:
 *   node scripts/announce-release.mjs                 # check once, dry run
 *   node scripts/announce-release.mjs --watch --post  # wait for the store, then post
 *   node scripts/announce-release.mjs --version 0.34.0 --post
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = 'https://raw.githubusercontent.com/charlesvestal/schwung/main/module-catalog.json';
const MODULE_ID = 'movy';
/* Not a secret — a channel id authorises nothing on its own, and this one is in
 * the channel's own URL. The credential is the webhook or bot token, and that
 * only ever comes from the environment. */
const DEFAULT_CHANNEL = '1480993519035224136';
/* Discord rejects a longer message outright; build-module.sh gates on this too,
 * so a file that got here is already within it unless it was edited after. */
const DISCORD_LIMIT = 2000;
const STATE = resolve(ROOT, '.announced.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

const POST = has('--post');
const WATCH = has('--watch');
const INTERVAL_S = Number(val('--interval', '60'));
const TIMEOUT_S = Number(val('--timeout', '3600'));

const die = (msg) => { console.error(`announce: ${msg}`); process.exit(1); };

async function getJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
}

/* Is the release the store would serve right now the one we are announcing?
 * Returns a reason string while it is not, or null once it is — the reason is
 * printed on every poll so a watch that never fires says WHY. */
async function storeOffers(version) {
    let catalog;
    try { catalog = await getJson(CATALOG); }
    catch (e) { return `catalog unreachable (${e.message})`; }

    const entry = catalog.modules?.find((m) => m.id === MODULE_ID);
    if (!entry) return `no "${MODULE_ID}" entry in the catalog — the module is not in the store`;

    const branch = entry.default_branch || 'main';
    const relUrl = `https://raw.githubusercontent.com/${entry.github_repo}/${branch}/release.json`;
    let rel;
    try { rel = await getJson(relUrl); }
    catch (e) { return `release.json unreadable (${e.message})`; }

    if (rel.version !== version) return `store still serving ${rel.version}, waiting for ${version}`;
    if (!rel.download_url) return 'release.json has no download_url';

    /* The catalog names the asset the host downloads; a release.json pointing at
     * a differently named file installs nothing. */
    if (entry.asset_name && !rel.download_url.endsWith(entry.asset_name)) {
        return `download_url does not end in the catalog's asset_name (${entry.asset_name})`;
    }

    /* The one check that catches a tagged release whose upload failed. */
    let head;
    try { head = await fetch(rel.download_url, { method: 'HEAD', redirect: 'follow' }); }
    catch (e) { return `asset unreachable (${e.message})`; }
    if (!head.ok) return `asset is HTTP ${head.status} — not downloadable yet`;

    return null;
}

async function send(text) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    const token = process.env.DISCORD_BOT_TOKEN;
    const channel = process.env.DISCORD_CHANNEL_ID || DEFAULT_CHANNEL;

    if (webhook) {
        const r = await fetch(webhook, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: text }),
        });
        if (!r.ok) die(`webhook rejected the post: ${r.status} ${await r.text()}`);
        return 'webhook';
    }
    if (token) {
        const r = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
            method: 'POST',
            headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ content: text }),
        });
        if (!r.ok) die(`Discord rejected the post: ${r.status} ${await r.text()}`);
        return `bot → channel ${channel}`;
    }
    die('no credential: set DISCORD_WEBHOOK_URL, or DISCORD_BOT_TOKEN (+ DISCORD_CHANNEL_ID).\n'
        + '        See docs/RELEASING.md. Never commit either one.');
}

const version = val('--version', JSON.parse(readFileSync(resolve(ROOT, 'module.json'), 'utf8')).version);
const annPath = resolve(ROOT, `docs/discord-v${version}.md`);
if (!existsSync(annPath)) die(`no announcement at docs/discord-v${version}.md`);
const text = readFileSync(annPath, 'utf8').trimEnd();
if (text.length > DISCORD_LIMIT) die(`announcement is ${text.length} chars; Discord caps at ${DISCORD_LIMIT}`);

/* Posting twice is worse than not posting: the first one is already read, and a
 * duplicate is what an automation looks like when it is broken. */
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
if (state[version]) {
    console.log(`announce: v${version} was already announced at ${state[version]} — nothing to do`);
    process.exit(0);
}

const deadline = Date.now() + TIMEOUT_S * 1000;
let reason = await storeOffers(version);
while (reason && WATCH) {
    if (Date.now() > deadline) die(`gave up after ${TIMEOUT_S}s: ${reason}`);
    console.log(`announce: ${reason} — retrying in ${INTERVAL_S}s`);
    await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
    reason = await storeOffers(version);
}
if (reason) die(`${reason}\n        (pass --watch to wait for it)`);

console.log(`announce: the store is serving v${version} (${text.length}/${DISCORD_LIMIT} chars)`);
if (!POST) {
    console.log('--- would post (dry run; pass --post to send) ---');
    console.log(text);
    process.exit(0);
}

const via = await send(text);
state[version] = new Date().toISOString();
writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
console.log(`announce: posted v${version} via ${via}`);
