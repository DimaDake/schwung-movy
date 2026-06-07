#!/usr/bin/env node
// Compiles src/**/*.ts -> dist/esm/**/*.js (no bundling; browser loads ES modules).
import * as esbuild from 'esbuild';
import { readdirSync, statSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');
const srcDir = resolve(root, 'src');

function findTs(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...findTs(full));
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

const entryPoints = findTs(srcDir);
await esbuild.build({
    entryPoints,
    bundle:         false,
    outdir:         resolve(root, 'dist/esm'),
    outbase:        srcDir,
    format:         'esm',
    target:         ['es2020'],
    sourcemap:      true,
    logLevel:       'info',
});
console.log(`Browser modules written: dist/esm/ (${entryPoints.length} files)`);
