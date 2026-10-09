#!/usr/bin/env node
/* scripts/host-globals.mjs — every host global movy depends on, written to
 * browser-test/host-globals.json.
 *
 * Two halves. MOVY's are the ambient declarations it compiles against
 * (src/platform/host-globals.d.ts, src/types/schwung.d.ts). The SHARED half is
 * what schwung's own .mjs files reach for at runtime: movy imports them from
 * the device's installed schwung (param_pages and friends), so a schwung update
 * can make them call a global the standalone host (movy-host, plan WP6) never
 * registered. That half is computed, not grepped — the TypeScript checker
 * reports every name the files use but never declare, plus every
 * `globalThis.<name>` the language itself does not provide (page_controller
 * reaches the held-step state that way).
 *
 * The suite browser-test/host-globals.mjs reruns the scan and fails on any
 * shared global the manifest does not list: the early warning that a schwung
 * bump would break the standalone flavour.
 *
 *   SCHWUNG=../schwung node scripts/host-globals.mjs           # print
 *   SCHWUNG=../schwung node scripts/host-globals.mjs --write   # update the manifest
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const MOVY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = join(MOVY, 'browser-test', 'host-globals.json');
const DEVICE_ROOT = '/data/UserData/schwung/';
const MOVY_DECLS = ['src/platform/host-globals.d.ts', 'src/types/schwung.d.ts'];

function walkTs(dir, acc = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkTs(p, acc);
        else if (p.endsWith('.ts')) acc.push(p);
    }
    return acc;
}

/** The ambient globals movy's TypeScript declares, i.e. what it can call. */
export function movyGlobals() {
    const names = new Set();
    for (const f of MOVY_DECLS) {
        const src = readFileSync(join(MOVY, f), 'utf8');
        for (const m of src.matchAll(/^declare (?:function|const|var|let) ([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    }
    return [...names].sort();
}

/* The device paths movy imports, mapped into the checkout (device `shared/x`
 * is `src/shared/x` there — the same mapping build/browser.mjs aliases), plus
 * everything they import in turn. */
function sharedFiles(schwung) {
    const files = new Set();
    const add = (f) => {
        if (files.has(f) || !existsSync(f)) return;
        files.add(f);
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]/g)) {
            add(resolve(dirname(f), m[1] ?? m[2]));
        }
    };
    for (const f of walkTs(join(MOVY, 'src'))) {
        for (const m of readFileSync(f, 'utf8').matchAll(/'\/data\/UserData\/schwung\/([^']+\.mjs)'/g)) {
            add(join(schwung, 'src', m[1]));
        }
    }
    return [...files];
}

/** { global: [files that use it] } for the shared JS movy loads from schwung.
 *  Bare-specifier imports the host must provide appear as `module:<name>`. */
export function sharedGlobals(schwung) {
    const files = sharedFiles(schwung);
    const program = ts.createProgram(files, {
        allowJs: true, checkJs: true, noEmit: true, types: [],
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts'],
    });
    const found = new Map();
    const note = (name, file) => {
        if (!found.has(name)) found.set(name, new Set());
        found.get(name).add(relative(schwung, file));
    };
    /* 2304/2552/2582: cannot find name. 2307/2792: cannot find module. */
    for (const d of ts.getPreEmitDiagnostics(program)) {
        if (!d.file) continue;
        const name = ts.flattenDiagnosticMessageText(d.messageText, '\n').match(/'([^']+)'/)?.[1];
        if (!name) continue;
        if ([2304, 2552, 2582].includes(d.code)) note(name, d.file.fileName);
        else if ([2307, 2792].includes(d.code)) note('module:' + name, d.file.fileName);
    }
    /* A JS file may read any property off globalThis without a diagnostic, so
     * these are walked: a name the standard library does not resolve is the
     * host's. */
    const checker = program.getTypeChecker();
    const fileSet = new Set(files);
    for (const sf of program.getSourceFiles()) {
        if (!fileSet.has(sf.fileName)) continue;
        const visit = (n) => {
            let name = null;
            const onGlobal = (e) => ts.isIdentifier(e) && e.text === 'globalThis';
            if (ts.isPropertyAccessExpression(n) && onGlobal(n.expression)) name = n.name.text;
            else if (ts.isElementAccessExpression(n) && onGlobal(n.expression)
                     && ts.isStringLiteral(n.argumentExpression)) name = n.argumentExpression.text;
            if (name && !checker.resolveName(name, sf, ts.SymbolFlags.Value, false)) note(name, sf.fileName);
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }
    return Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, [...v].sort()]));
}

export function schwungCommit(schwung) {
    try {
        return execFileSync('git', ['-C', schwung, 'log', '-1', '--format=%h'], { encoding: 'utf8' }).trim();
    } catch { return 'unknown'; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (!process.env.SCHWUNG) {
        console.error('host-globals: set SCHWUNG=/path/to/schwung');
        process.exit(2);
    }
    const schwung = resolve(process.env.SCHWUNG);
    const manifest = {
        _comment: 'Generated by scripts/host-globals.mjs — every global movy-host must answer. Regenerate with --write.',
        scannedAt: schwungCommit(schwung),
        movy: movyGlobals(),
        shared: sharedGlobals(schwung),
    };
    const out = JSON.stringify(manifest, null, 2) + '\n';
    if (process.argv.includes('--write')) {
        writeFileSync(MANIFEST, out);
        console.log(`host-globals: wrote ${relative(MOVY, MANIFEST)} `
            + `(${manifest.movy.length} movy, ${Object.keys(manifest.shared).length} shared)`);
    } else {
        process.stdout.write(out);
    }
}
