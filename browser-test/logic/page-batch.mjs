/* browser-test/logic/page-batch.mjs — SP-39's key list: WHICH keys one bulk
 * request asks for, and which of them retire.
 *
 * `renderer/schwung-page-batch.ts` is pure (a Map, a port, an epoch), so this is
 * the cheapest level that can hold it, and it exists because the file shipped
 * with ZERO coverage in either tier — `batchKeys`, KEEP_EPOCHS, BATCH_MAX_KEYS
 * and BATCH_VALUE_MAX were named nowhere but their own comments, which is how a
 * reviewed commit could make the batch mark what it READ as what a caller ASKED
 * FOR and still pass every gate. The cost of that is not visible in a suite that
 * counts expected-fail labels: past the 48-key cap the tie-break compares equal
 * `asked` values, so it degenerates to insertion order, the OLDEST keys win the
 * bulk request, and the page on screen pays one `port.getParam` round trip per
 * cell — the ~3.4 ms read SP-26/SP-39 exist to remove.
 *
 * THE INVARIANT, in one line: `asked` moves when a CALLER asks for a key (a get
 * that missed, a `warm`), and never because the batch itself read it.
 *
 * Run by browser-test/logic.mjs.
 */

import { batchKeys, fill, ok, eq, _log,
         KEEP_EPOCHS, BATCH_MAX_KEYS, BATCH_VALUE_MAX } from './harness.mjs';

/* A port that answers every key with a small value. `fill` reaches the port
 * through `getMany` only, so this is the whole of what the batch needs, and the
 * values it returns are the ones `len` is taken from. */
function port(value = '0.50') {
    return { getMany: (keys) => keys.map(() => value) };
}

/* An entry as `batchKeys` sees it: read at `epoch`, last ASKED at `asked`. */
const e = (epoch, asked, len = 4) => ({ value: '0.50', epoch, asked, len });

export async function run() {

_log('\nlogic: page batch — which keys ride the one bulk request (SP-39)');

/* ── 1. The tie-break is recency, not insertion order ────────────────────────
 *
 * THE BASELINE THE OTHER BLOCKS DEPEND ON. Three buckets that are all still
 * inside KEEP_EPOCHS (so nothing prunes and the cap is the only thing acting),
 * inserted OLDEST FIRST, so insertion order and recency disagree by
 * construction. This one holds with the `asked` bug present or absent —
 * `batchKeys` itself was never the defect — and it is here because the eviction
 * below is only a bug if `asked` is what the cap sorts on. */
{
    const E = 1000;
    const entries = new Map();
    const old = [], mid = [], live = [];
    for (let i = 0; i < 40; i++) old.push('old' + i);
    for (let i = 0; i < 20; i++) mid.push('mid' + i);
    for (let i = 0; i < 12; i++) live.push('live' + i);
    for (const k of old)  entries.set(k, e(E - KEEP_EPOCHS, E - KEEP_EPOCHS));
    for (const k of mid)  entries.set(k, e(E - 1, E - 1));
    for (const k of live) entries.set(k, e(E, E));

    const keys = batchKeys(entries, E);
    eq('the cap is what is acting, so the request is exactly BATCH_MAX_KEYS',
       keys.length, BATCH_MAX_KEYS);
    eq('the MOST RECENTLY ASKED keys lead, though they were inserted last',
       keys.slice(0, live.length).join(','), live.join(','));
    ok('the middle bucket rides next, and only the oldest is cut',
       mid.every((k) => keys.includes(k)) && keys.filter((k) => old.includes(k)).length
           === BATCH_MAX_KEYS - live.length - mid.length);
}

/* ── 2. A READ is not an ASK ─────────────────────────────────────────────────
 *
 * The defect itself, at the point it happens: `fill` prefetches keys the batch
 * chose, and that must leave each one's `asked` where it was. Stamping it here
 * makes a key self-promoting — it enters the request by being read and stays by
 * being read — so nothing in `entries` can ever be retired for going unasked. */
{
    const E = 1000;
    const entries = new Map();
    const seeded = [];
    for (let i = 0; i < 60; i++) { const k = 'stale' + i; seeded.push(k); entries.set(k, e(E - KEEP_EPOCHS, E - KEEP_EPOCHS)); }
    for (let i = 0; i < 12; i++) { const k = 'live' + i; seeded.push(k); entries.set(k, e(E, E)); }
    const before = seeded.map((k) => entries.get(k).asked);

    fill(port(), entries, E);

    const read = seeded.filter((k) => entries.get(k).epoch === E);
    ok('the fill really did read (otherwise this block proves nothing)',
       read.length > 0 && read.length <= BATCH_MAX_KEYS);
    eq('a prefetched key is not thereby asked for',
       seeded.map((k) => entries.get(k).asked).join(','), before.join(','));
}

/* ── 3. Retirement: unasked for KEEP_EPOCHS + 1 epochs is DROPPED ────────────
 *
 * The consequence of 2, and the reason the cap in 4 goes wrong without it. A key
 * is READ at the last epoch it is still inside the window (KEEP_EPOCHS exactly),
 * then asked for by nobody; one epoch later its own last ask is KEEP_EPOCHS + 1
 * epochs old and the prune must take it. It stays instead if the read stamped
 * `asked`, which is an unbounded life for every key the batch has ever held. */
{
    const E = 1000;
    const entries = new Map([['k', e(E, E)]]);

    fill(port(), entries, E + KEEP_EPOCHS);
    eq('still alive at KEEP_EPOCHS, so the fill read it', entries.size, 1);

    const keys = batchKeys(entries, E + KEEP_EPOCHS + 1);
    eq('a key unasked for KEEP_EPOCHS + 1 epochs is dropped from the map',
       entries.size, 0);
    eq('and from the request', keys.length, 0);
}

/* ── 4. The A/B: with more than the cap alive, the LIVE set is what is asked ──
 *
 * The reviewer's shape, and the one that costs the user something. A page's
 * keys are asked for last (a `warm` on the page that just arrived), so they are
 * the most recent; behind them sit keys an earlier page left in the map. One
 * fill round runs, and then the question is which of them the NEXT round asks
 * for. By their own asks the live twelve are untouchable and the stale sixty are
 * past the window and gone. */
{
    const E = 1000;
    const entries = new Map();
    const stale = [], live = [];
    for (let i = 0; i < 60; i++) { const k = 'stale' + i; stale.push(k); entries.set(k, e(E - KEEP_EPOCHS, E - KEEP_EPOCHS)); }
    for (let i = 0; i < 12; i++) { const k = 'live' + i; live.push(k); entries.set(k, e(E, E)); }

    fill(port(), entries, E);
    const keys = batchKeys(entries, E + KEEP_EPOCHS);

    eq('the request is the live set, and nothing else', keys.join(','), live.join(','));
    eq('and the stale keys have retired from the map rather than from the request',
       entries.size, live.length);
}

/* ── 5. A big value is read alone ────────────────────────────────────────────
 *
 * BATCH_VALUE_MAX is applied at PRUNING and nowhere else, so this asserts the
 * policy where it lives: the massive `ui_hierarchy`/`chain_params` cells of the
 * fleet's heaviest module must stay out of a response whose budget they would
 * consume, and a value at exactly the limit is ordinary. */
{
    const E = 1000;
    const entries = new Map([
        ['small',   e(E, E, 4)],
        ['at-cap',  e(E, E, BATCH_VALUE_MAX)],
        ['over',    e(E, E, BATCH_VALUE_MAX + 1)],
    ]);
    const keys = batchKeys(entries, E);
    ok('an oversized value stays out of the request', !keys.includes('over'));
    ok('a value at the limit is ordinary', keys.includes('at-cap') && keys.includes('small'));
}

}
