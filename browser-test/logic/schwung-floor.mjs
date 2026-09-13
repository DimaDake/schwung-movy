/* schwung-floor.mjs — an under-floor Schwung must say WHICH version it needs.
 *
 * schwungLibAvailable() answers availability, not vintage, and that gap has a
 * shape: a Schwung with all six param_pages files but an older page_plan.mjs
 * fails with a LINK error ("Could not find export 'navLabelsOf'"), which is
 * caught and reported as "unavailable" — true, and useless to the person
 * holding the device. */
import { ok, eq, _log } from './harness.mjs';

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
     * here: every case above feeds SCHWUNG_FLOOR into the reader that compares
     * against it, so the five of them pass with the constant set to ANY value.
     * Measured, not assumed — setting it to '99.0.0' (Step 8's own mutation)
     * leaves all five green. A floor that cannot fail is the dead feature this
     * task exists to prevent, so the VALUE is pinned here, and the COMPARISON
     * is pinned separately below. */
    eq('the floor is the version this movy needs', SCHWUNG_FLOOR, '1.3.0');

    /* Per component and NUMERICALLY. A string compare puts '1.10.0' BELOW
     * '1.3.0', which would pin a perfectly good Schwung to MOVY the first time
     * the minor version reached double digits. */
    serve('1.10.0');
    eq('a double-digit minor version is newer, which a string compare gets backwards',
        schwungFloorMet(), true);

    globalThis.host_read_file = realRead;
    ok('the floor reads release.json and reports its reason');
}
