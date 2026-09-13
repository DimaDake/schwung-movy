/* schwung-floor.ts — which Schwung this movy needs, and how to say so.
 *
 * `schwungLibAvailable()` answers whether the six param_pages modules IMPORTED,
 * which is not the same question. A Schwung with all six files present but an
 * older page_plan.mjs fails with a LINK error — "Could not find export
 * 'navLabelsOf'" — and schwung-lib.ts catches it and reports "unavailable":
 * true, and nothing the person holding the device can act on.
 *
 * WHY THIS VALUE. `page` mode needs main at or past #405 (widget_registry.mjs),
 * #411 (voices.mjs), #414 and #415; an older install is missing those two files
 * outright. 1.3.0 is where the param contract ceiling became 128 KB, which movy
 * matches in chain_host.rs. Raise this when a feature starts depending on a
 * newer Schwung, and say which feature in the commit.
 */
export const SCHWUNG_FLOOR = '1.3.0';

const RELEASE = '/data/UserData/schwung/release.json';

/* WHERE THE INSTALLED VERSION ACTUALLY LIVES. `release.json` is not a file a
 * running Schwung keeps: it is the store descriptor fetched from GitHub
 * (`store_utils.mjs:78`, `install.sh:907`) and cached under `tmp/`. The version
 * a host INSTALLED on the box reports is `/data/UserData/schwung/host/
 * version.txt` — what `getHostVersion()` reads, what the installer writes, what
 * `collect-diagnostics.sh` prints. Measured on the device 2026-09-13: nothing
 * named release.json anywhere under /data/UserData, and version.txt = 1.4.0.
 *
 * release.json stays FIRST because it is the path this feature was specified
 * against and a build that ships one should win. version.txt is what keeps the
 * floor from being INERT: with release.json alone every real device reads as
 * "unknown", unknown reads as met on purpose, and the switch is therefore never
 * pinned — a floor that cannot fail, which is not a floor.
 */
const HOST_VERSION = '/data/UserData/schwung/host/version.txt';

/* PER COMPONENT, NUMERICALLY. A string compare puts '1.10.0' BELOW '1.3.3',
 * which would pin a perfectly good Schwung to MOVY the first time the minor
 * version reached double digits — a bug that hides for a year and then bites
 * every user at once.
 *
 * A DELIBERATE COPY of upstream's `compareVersions` (schwung/src/shared/
 * store_utils.mjs:34-45), which movy COULD import off the device the way
 * schwung-lib.ts imports its param_pages — by absolute
 * `/data/UserData/schwung/shared/...` path. It must not: the host whose version
 * this computes is exactly the thing that may be too old to export it, so
 * importing would reintroduce the link error this module exists to report, on
 * the one device that needs a version answer most. Dedupe it and the hazard
 * comes back. */
function atLeast(have: string, want: string): boolean {
    const h = have.split('.').map((n) => parseInt(n, 10) || 0);
    const w = want.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(h.length, w.length); i++) {
        const a = h[i] ?? 0, b = w[i] ?? 0;
        if (a !== b) return a > b;
    }
    return true;                                  /* equal meets the floor */
}

/** The installed version, or '' when it cannot be read. */
export function schwungVersion(): string {
    try {
        const raw = host_read_file(RELEASE);
        /* A release.json that PARSES but carries no `version` is not a version
         * either, so it falls through to the host's own file exactly as an
         * absent or corrupt one does. Returning its empty string here
         * short-circuits the chain — and the device that carries both files is
         * precisely where that leaves the floor reading '' = met = inert. */
        const v = raw ? String(JSON.parse(raw).version || '') : '';
        if (v) return v;
    } catch { /* a corrupt release.json is not a version — try the host's own */ }
    try {
        const raw = host_read_file(HOST_VERSION);
        return raw ? raw.trim() : '';
    } catch { return ''; }
}

/*
 * UNKNOWN IS NOT UNDER-FLOOR, and this is a deliberate choice rather than a
 * lenient default: a dev install — a checkout rsync'd onto the device — has no
 * release.json at all, and refusing the grid there would make the whole feature
 * untestable on the only machine that can test it. A wrong `true` here costs a
 * confusing render; a wrong `false` costs the device.
 *
 * UNREADABLE IS NOT THE ONLY FAIL-OPEN CASE, and the way the two directions
 * differ is a choice too. Measured: absent -> met; '1.4' -> met (a missing
 * component counts as 0, and 4 > 3 at index 1); 'banana' -> PINNED;
 * 'v1.4.0' -> PINNED. `atLeast` reads each component with parseInt and takes 0
 * for whatever it cannot read, so garbage reads as an OLD version. For a gate,
 * fail-CLOSED on garbage is the more dangerous of the two — one unrecognised
 * prefix would switch the feature off on every device at once — but it is what
 * upstream's own `compareVersions` does with the same algorithm, so movy and
 * the host agree about what a version string means. It is also loud: the
 * Settings hint names the version it thinks it is holding.
 */
export function schwungFloorMet(): boolean {
    const v = schwungVersion();
    return v === '' ? true : atLeast(v, SCHWUNG_FLOOR);
}

/** Why the switch is stuck on MOVY, for the Settings hint. Empty when it is not. */
export function schwungFloorReason(): string {
    if (schwungFloorMet()) return '';
    return 'needs Schwung ' + SCHWUNG_FLOOR + ' (have ' + schwungVersion() + ')';
}

/*
 * THE READ-ONCE PAIR, and it is the one the mode gate and the Settings hint
 * use. Both CALLERS are on hot paths: `schwungGridMode` is asked on every
 * rendered frame AND on every knob event, and the Settings hint is composed
 * whenever that page redraws. The read behind their answer is not on them — it
 * is paid once, lazily, on the first of those calls, and never again. Said at
 * that length because the careless reading of the next sentence is wrong: what
 * Schwung's budget forbids is a `host_read_file` ON the draw path (PARAM_PAGES.md;
 * shadow_ui.js says it of its own draw path: "a host_read_file on the draw path
 * is what the read budget forbids"), and one read at the first draw or knob
 * event is not a read on that path.
 *
 * One read, and the answer cannot go stale under it: installing a different
 * Schwung RESTARTS THE STACK — that is the whole point of
 * `scripts/install-schwung-fork.sh` — so a per-process answer is a per-host
 * answer. The uncached pair above stays, because a check that reads what is on
 * disk NOW is the only kind the suite can drive.
 */
let once: { met: boolean; reason: string } | null = null;

/** Met, read at most once per tool load. For the draw and input paths. */
export function schwungFloorMetOnce(): boolean {
    return onceRead().met;
}

/** The reason, from the same single read, so the two can never disagree. */
export function schwungFloorReasonOnce(): string {
    return onceRead().reason;
}

function onceRead(): { met: boolean; reason: string } {
    return (once ??= { met: schwungFloorMet(), reason: schwungFloorReason() });
}

/*
 * FOR TESTS ONLY. Production gets a fresh answer the way it gets a fresh
 * Schwung — by restarting the stack, which installing one does — so there is
 * nothing here for it to call. A suite has no such lever: the mode gate pins to
 * MOVY and the only way to make it ask again is to drop the read that answers
 * "can Schwung serve what the flag is offering".
 */
export function resetSchwungFloorOnce(): void { once = null; }
