#!/usr/bin/env node
/* Tell me when the store is actually serving a release, and hand me the
 * announcement to post.
 *
 * The tag is not the moment worth announcing. A user's Move is offered whatever
 * `release.json` on the module's default branch says, so a release is live only
 * once the catalog carries the entry, that file advertises the new version, and
 * the asset it points at can really be downloaded. Announcing on the tag can
 * tell people to update to something the store is not serving yet — or, if the
 * asset upload failed, will never serve.
 *
 * It does NOT post. Posting to Discord needs a webhook or bot credential that
 * has to be created by hand in the server, and a half-working send path is
 * worse than none: it would be the one step nobody checks. So this prints the
 * message and you paste it. If a credential ever exists, the send belongs here,
 * behind an explicit flag — see git history for a version that had one.
 *
 * Usage:
 *   node scripts/announce-release.mjs            # is it live? print the message
 *   node scripts/announce-release.mjs --watch    # wait until it is, then print
 *   node scripts/announce-release.mjs --version 0.34.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = 'https://raw.githubusercontent.com/charlesvestal/schwung/main/module-catalog.json';
const MODULE_ID = 'movy';
/* Discord rejects a longer message outright; build-module.sh gates on this too,
 * so a file that got here is already within it unless it was edited after. */
const DISCORD_LIMIT = 2000;

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const WATCH = args.includes('--watch');
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

const version = val('--version', JSON.parse(readFileSync(resolve(ROOT, 'module.json'), 'utf8')).version);
const annPath = resolve(ROOT, `docs/discord-v${version}.md`);
if (!existsSync(annPath)) die(`no announcement at docs/discord-v${version}.md`);
const text = readFileSync(annPath, 'utf8').trimEnd();
if (text.length > DISCORD_LIMIT) die(`announcement is ${text.length} chars; Discord caps at ${DISCORD_LIMIT}`);

const deadline = Date.now() + TIMEOUT_S * 1000;
let reason = await storeOffers(version);
while (reason && WATCH) {
    if (Date.now() > deadline) die(`gave up after ${TIMEOUT_S}s: ${reason}`);
    console.log(`announce: ${reason} — retrying in ${INTERVAL_S}s`);
    await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
    reason = await storeOffers(version);
}
if (reason) die(`${reason}\n        (pass --watch to wait for it)`);

console.log(`announce: the store is serving v${version} — post this (${text.length}/${DISCORD_LIMIT} chars):\n`);
console.log(text);
