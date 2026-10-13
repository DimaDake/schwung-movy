#!/usr/bin/env node
/* The schwung JS movy runs, from the pinned tag (plans/2026-10-13-pin-schwung-js.md).
 *
 * Seeds are every `/data/UserData/schwung/{shared,shadow}/…` module path movy's
 * source names (src/**.ts and build/device.mjs's banner). From each, every
 * static import is followed — relative AND absolute, since schwung's shared
 * files import each other by device path — through the tag's tree. The result
 * is what movy-host loads from <module dir>/schwung/ (host/module_path.c).
 *
 *   node scripts/schwung-js-closure.mjs <tag tree src/> <out dir>
 *
 * A seed the tag lacks is reported, not fatal: movy imports a few files
 * dynamically with a fallback for a schwung without them. A file the closure
 * reaches that the tag lacks IS fatal: the pinned copy would fail to link. */
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOVY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEVICE_ROOT = '/data/UserData/schwung/';
const PINNED_DIRS = /^\/data\/UserData\/schwung\/((?:shared|shadow)\/[^'"\s]+\.mjs)$/;

function walk(dir, acc = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (p.endsWith('.ts')) acc.push(p);
    }
    return acc;
}

export function seeds() {
    const out = new Set();
    for (const f of [...walk(join(MOVY, 'src')), join(MOVY, 'build', 'device.mjs')]) {
        for (const m of readFileSync(f, 'utf8').matchAll(/['"](\/data\/UserData\/schwung\/[^'"]+\.mjs)['"]/g)) {
            const rel = PINNED_DIRS.exec(m[1]);
            if (rel) out.add(rel[1]);
        }
    }
    return [...out].sort();
}

/* Device-relative paths ("shared/x.mjs") of the closure, and the seeds the tree lacks. */
export function closure(tree) {
    const files = new Set(), missingSeeds = [], broken = [];
    const visit = (rel, from) => {
        if (files.has(rel)) return;
        if (!existsSync(join(tree, rel))) { (from ? broken : missingSeeds).push(from ? `${rel} (from ${from})` : rel); return; }
        files.add(rel);
        const src = readFileSync(join(tree, rel), 'utf8');
        for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
            const spec = m[1];
            let next = null;
            if (spec.startsWith('.')) next = posix.normalize(posix.join(posix.dirname(rel), spec));
            else if (spec.startsWith(DEVICE_ROOT)) next = PINNED_DIRS.exec(spec)?.[1] ?? null;
            if (next) visit(next, rel);
        }
    };
    for (const s of seeds()) visit(s, null);
    return { files: [...files].sort(), missingSeeds, broken };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [tree, out, tag] = process.argv.slice(2);
    if (!tree || !out) { console.error('usage: schwung-js-closure.mjs <tag src/> <out> [tag]'); process.exit(2); }
    const { files, missingSeeds, broken } = closure(resolve(tree));
    if (broken.length) { console.error(`schwung-js: the pinned tree cannot link:\n  ${broken.join('\n  ')}`); process.exit(1); }
    rmSync(out, { recursive: true, force: true });
    for (const f of files) {
        mkdirSync(dirname(join(out, f)), { recursive: true });
        copyFileSync(join(tree, f), join(out, f));
    }
    writeFileSync(join(out, 'PIN'), `${tag ?? '?'}\n${files.join('\n')}\n`);
    console.log(`schwung-js: ${files.length} files from ${tag ?? relative(MOVY, tree)}`
        + (missingSeeds.length ? `; not in the tag (movy's fallback runs): ${missingSeeds.join(', ')}` : ''));
}
