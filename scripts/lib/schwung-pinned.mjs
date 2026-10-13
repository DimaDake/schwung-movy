/* The schwung tree the suites test against: the PINNED tag's src/shared and
 * src/shadow (scripts/build-schwung-js.sh --tree), the bytes movy ships —
 * never the checkout's working tree, which follows origin/main.
 * (plans/2026-10-13-pin-schwung-js.md)
 *
 * SCHWUNG= says WHERE the schwung git repo is (../schwung by default);
 * this says WHICH schwung the suites run. Returns a root laid out
 * like a checkout (`<root>/src/shared/...`). */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOVY = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let cached = null;

export function pinnedSchwungRoot() {
    if (!cached) {
        cached = execFileSync('bash', [resolve(MOVY, 'scripts', 'build-schwung-js.sh'), '--tree'],
                              { encoding: 'utf8', env: process.env }).trim();
    }
    return cached;
}
