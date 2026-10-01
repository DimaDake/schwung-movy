/* chain-table.mjs — the chain host's param table for a dumped module, built by
 * schwung's own C parser (browser-test/native/chain-table.c).
 *
 * WHY NATIVE. The question this answers is "does a CC 102+lane for key K reach
 * the module", and the answer is an exact scan of a table whose contents depend
 * on schwung's merge order, its dedupe and its 256-entry cap. A JS restatement
 * of that parser would be one more copy to drift — the cap alone is the whole
 * difference between sophie's pad 15 and pad 16. So the driver links
 * SCHWUNG's chain_params.c + chain_json.c, the same two files schwung's own
 * tests/host/test_chain_params_max_param.sh compiles, with the same one-line
 * malloc.h shim.
 *
 * Returns null (and says why) when there is no SCHWUNG checkout or no C
 * compiler, so a caller can SKIP loudly rather than report an empty table as a
 * finding.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

let built = undefined;   // path to the binary, null when it cannot be built
let why = '';

/** Why `chainTables` returned null, for the SKIPPED line. */
export function chainTableUnavailable() { return why; }

function binary() {
    if (built !== undefined) return built;
    built = null;
    const sw = process.env.SCHWUNG ? resolve(process.env.SCHWUNG) : null;
    const dsp = sw && join(sw, 'src', 'modules', 'chain', 'dsp');
    if (!dsp || !existsSync(join(dsp, 'chain_params.c'))) {
        why = 'no SCHWUNG checkout with src/modules/chain/dsp';
        return built;
    }
    const work = mkdtempSync(join(tmpdir(), 'movy-chain-table-'));
    mkdirSync(join(work, 'shim'));
    /* chain_internal.h includes <malloc.h>, which is glibc-only. */
    writeFileSync(join(work, 'shim', 'malloc.h'), '#include <stdlib.h>\n');
    const out = join(work, 'chain-table');
    try {
        execFileSync('cc', ['-std=gnu11', '-w', '-I' + join(work, 'shim'),
            '-I' + join(sw, 'src'), '-I' + dsp, '-I' + join(sw, 'src', 'host'),
            join(HERE, 'native', 'chain-table.c'),
            join(dsp, 'chain_params.c'), join(dsp, 'chain_json.c'), '-o', out],
            { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
        why = 'cc failed: ' + String(e.stderr || e.message).split('\n')[0];
        return built;
    }
    built = out;
    return built;
}

/**
 * `{ max, static, dynamic }` for one dump entry: the table a load leaves
 * (module.json) and the one a runtime refresh swaps in (the plugin's own
 * chain_params), each as the key list the chain host would scan. Either list
 * is null when there is nothing to parse.
 */
export function chainTables(entry) {
    const bin = binary();
    if (!bin) return null;
    const dir = mkdtempSync(join(tmpdir(), 'movy-chain-mod-'));
    writeFileSync(join(dir, 'module.json'), JSON.stringify(entry.module_json ?? {}));
    const cp = entry.params?.chain_params;
    const args = [dir];
    if (typeof cp === 'string' && cp.length) {
        writeFileSync(join(dir, 'cp.json'), cp);
        args.push(join(dir, 'cp.json'));
    }
    return JSON.parse(execFileSync(bin, args, { encoding: 'utf8' }));
}
