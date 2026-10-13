/* schwung-floor.ts — the oldest INSTALLED Schwung movy-host accepts.
 *
 * One definition: scripts/build-host.sh greps it into movy-host, which refuses
 * to start below it (host/main.c). movy's own JS is the pinned tag's copy, so
 * nothing on the JS side checks it any more.
 *
 * WHY THIS VALUE. 1.3.0 is where the param contract ceiling became 128 KB, which movy
 * matches in chain_host.rs. 1.5.0 carries #541 (`io.isAutomated`, the lane's
 * own mark) and #543 (`display: "big"`, `turn: "absolute"`,
 * `io.allowEnumPeek`, `activity()`), and movy no longer ships the stand-ins
 * for any of them — below it the lanes would lose their pointer motion and
 * the big cells would draw as plain arcs. Raise this when a feature starts
 * depending on a newer Schwung, and say which feature in the commit.
 */

export const SCHWUNG_FLOOR = '1.5.0';
