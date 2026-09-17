/* schwung-floor.mjs — an under-floor Schwung must say WHICH version it needs.
 *
 * schwungLibAvailable() answers availability, not vintage, and that gap has a
 * shape: a Schwung with all six param_pages files but an older page_plan.mjs
 * fails with a LINK error ("Could not find export 'navLabelsOf'"), which is
 * caught and reported as "unavailable" — true, and useless to the person
 * holding the device. */
import { eq, _log } from './harness.mjs';

export async function run() {
    _log('\nlogic: the schwung version floor');

    const { schwungFloorMet, schwungFloorReason, SCHWUNG_FLOOR } =
        await import('../../dist/esm/renderer/schwung-floor.js');

    const realRead = globalThis.host_read_file;
    const serve = (v) => { globalThis.host_read_file = (p) =>
        p === '/data/UserData/schwung/release.json'
            ? (v === null ? null : JSON.stringify({ version: v, download_url: '' }))
            : realRead?.(p) ?? null; };

    serve('0.11.4');
    eq('an old Schwung fails the floor', schwungFloorMet(), false);
    eq('and the reason names the floor', schwungFloorReason().includes(SCHWUNG_FLOOR), true);

    serve(SCHWUNG_FLOOR);
    eq('exactly the floor passes', schwungFloorMet(), true);

    serve('99.0.0');
    eq('a newer Schwung passes', schwungFloorMet(), true);

    /* No release.json at all is the interesting case: it is what a dev install
     * looks like, and refusing the grid there would make the device
     * untestable. Unknown is not under-floor. */
    serve(null);
    eq('an unreadable version does not fail the floor', schwungFloorMet(), true);

    /* THE TWO ASSERTIONS EVERYTHING ABOVE CANNOT MAKE, and the reason they are
     * here: four of the five cases above feed SCHWUNG_FLOOR into the reader that
     * compares against it, so none of them detects the floor being RAISED —
     * which is Step 8's mutation, and the one that matters. Measured, not
     * assumed: at '99.0.0' all five are green. (Two of them DO red when the
     * floor is LOWERED — 'an old Schwung fails the floor' and 'and the reason
     * names the floor', measured at '0.1.0' — so the blindness is directional,
     * not total.) A floor that cannot fail is the dead feature this task exists
     * to prevent, so the VALUE is pinned here, and the COMPARISON is pinned
     * separately below. */
    eq('the floor is the version this movy needs', SCHWUNG_FLOOR, '1.3.0');

    /* Per component and NUMERICALLY. A string compare puts '1.10.0' BELOW
     * '1.3.0', which would pin a perfectly good Schwung to MOVY the first time
     * the minor version reached double digits. */
    serve('1.10.0');
    eq('a double-digit minor version is newer, which a string compare gets backwards',
        schwungFloorMet(), true);

    /* ── the fallback chain, and the rung a real device reads ─────────────── */
    /* `release.json` is the store descriptor fetched from GitHub and is NOT on
     * the box at all (Environment facts in the ledger); what a host reports it
     * installed is `/data/UserData/schwung/host/version.txt`. Two rungs, and
     * both have to stay reachable: a `release.json` that PARSES but carries no
     * `version` skips the second rung entirely if the first hands back its
     * empty string — and an empty string is not "unreadable", so it does not
     * reach the fail-open default either. It just makes the floor inert. */
    const HOST = '/data/UserData/schwung/host/version.txt';
    const chain = (releaseBody, hostBody) => { globalThis.host_read_file = (p) =>
        p === '/data/UserData/schwung/release.json' ? releaseBody
            : p === HOST ? hostBody
            : realRead?.(p) ?? null; };

    chain('{"download_url":""}', '0.1.0');
    eq('a versionless release.json falls through to the host version',
        schwungFloorMet(), false);

    chain(null, '0.1.0');
    eq('and an absent release.json does', schwungFloorMet(), false);

    /* THE RUNG THAT ANSWERS IN PRODUCTION. If it goes, the floor is inert on
     * every real device while every other assertion here stays green. */
    chain(null, '0.9.9');
    eq('the host version file alone pins the floor', schwungFloorMet(), false);

    globalThis.host_read_file = realRead;
}
