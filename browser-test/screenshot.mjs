#!/usr/bin/env node
/* browser-test/screenshot.mjs — capture movy display screenshots and compare
 * against committed baselines for visual regression detection.
 *
 * Usage:
 *   cd browser-test && npm install
 *   node screenshot.mjs           # compare against baseline (exit 1 on diff)
 *   node screenshot.mjs --update  # overwrite baselines with current renders
 *
 * Baselines in screenshots/baseline/ are committed to git.
 * Actual captures go to screenshots/actual/ (gitignored).
 */

import puppeteer           from 'puppeteer';
import { createServer }    from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }   from 'path';
import { fileURLToPath }   from 'url';
import { createReadStream } from 'fs';
import { extname }         from 'path';
import { PNG }             from 'pngjs';
import pixelmatch          from 'pixelmatch';
import { spawn }           from 'child_process';

const __dir      = dirname(fileURLToPath(import.meta.url));
const MOVY_ROOT  = join(__dir, '..');
const BASE_DIR   = join(__dir, 'screenshots', 'baseline');
const ACTUAL_DIR = join(__dir, 'screenshots', 'actual');
const UPDATE     = process.argv.includes('--update');

const PRESETS = [
    'test8', 'test16', 'test_enum', 'plaits', 'wurl',
    'enum_overlay', 'knob_toast', 'no_params', 'keys_view', 'browse_view',
    'obxd_preset_page', 'obxd_main_page', 'obxd_filter_page',
    'lfo_prefix',
    'chain_synth', 'chain_empty', 'chain_jog_toast', 'knobs_jog_toast',
];
const MIME = {
    '.html': 'text/html',
    '.mjs':  'text/javascript',
    '.js':   'text/javascript',
    '.json': 'application/json',
    '.png':  'image/png',
    '.otf':  'font/otf',
};

/* ── Local HTTP server ───────────────────────────────────────────────────── */

function startServer(root, port) {
    return new Promise(resolve => {
        const server = createServer((req, res) => {
            let path = req.url.split('?')[0];
            if (path.endsWith('/')) path += 'index.html';
            const file = join(root, path);
            try {
                const body = readFileSync(file);
                const ext  = extname(file);
                res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
                res.end(body);
            } catch {
                res.writeHead(404);
                res.end('Not found: ' + path);
            }
        });
        server.listen(port, () => resolve(server));
    });
}

/* ── PNG pixel comparison ────────────────────────────────────────────────── */

function diffPngs(baselinePath, actualPath) {
    const baseline = PNG.sync.read(readFileSync(baselinePath));
    const actual   = PNG.sync.read(readFileSync(actualPath));
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
        return { different: true, reason: 'size mismatch' };
    }
    const diff  = new PNG({ width: baseline.width, height: baseline.height });
    const count = pixelmatch(
        baseline.data, actual.data, diff.data,
        baseline.width, baseline.height,
        { threshold: 0.1 },
    );
    return { different: count > 0, count };
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
    mkdirSync(BASE_DIR,   { recursive: true });
    mkdirSync(ACTUAL_DIR, { recursive: true });

    const PORT   = 18080 + Math.floor(Math.random() * 100);
    const server = await startServer(MOVY_ROOT, PORT);
    const url    = `http://localhost:${PORT}/browser-test/`;

    const browser = await puppeteer.launch({ headless: 'new' });
    const page    = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    let pass = 0, fail = 0;

    for (const preset of PRESETS) {
        process.stdout.write(`  ${preset} ... `);

        await page.goto(url, { waitUntil: 'networkidle0' });

        /* Determine which mock preset to load, then apply any view override */
        const syntheticPresets = { enum_overlay: 'plaits', knob_toast: 'test8',
                                   no_params: 'no_params', keys_view: 'test8',
                                   browse_view: 'test8',
                                   obxd_preset_page: 'obxd_like',
                                   obxd_main_page:   'obxd_like',
                                   obxd_filter_page: 'obxd_like',
                                   chain_synth:      'test8',
                                   chain_empty:      'test8',
                                   chain_jog_toast:  'test8',
                                   knobs_jog_toast:  'test8' };
        const basePreset = syntheticPresets[preset] ?? preset;
        await page.select('#preset-select', basePreset);

        /* Wait for model.tick() to run and render */
        await page.waitForFunction(
            () => document.getElementById('vm-inspector')?.textContent.trim().length > 0,
            { timeout: 3000 },
        );
        await new Promise(r => setTimeout(r, 200));  /* extra rAF settle */

        /* Synthetic view states */
        if (preset === 'enum_overlay') {
            await page.evaluate(() => {
                globalThis.__movy_model?.handleKnobTouch(0);
                globalThis.__movy_forceRender?.();
            });
            await new Promise(r => setTimeout(r, 50));
        } else if (preset === 'knob_toast') {
            await page.evaluate(() => {
                globalThis.__movy_model?.handleKnobTouch(2);
                globalThis.__movy_forceRender?.();
            });
        } else if (preset === 'keys_view') {
            await page.evaluate(() => { globalThis.__movy_renderKeysView?.(); });
        } else if (preset === 'browse_view') {
            await page.evaluate(() => {
                globalThis.__movy_renderBrowseView?.(
                    [{ name: 'Plaits' }, { name: 'Wurl' }, { name: 'Bass' }], 1
                );
            });
        } else if (preset === 'obxd_preset_page') {
            /* page 0 = dedicated Preset page */
            await page.evaluate(() => { globalThis.__movy_forceRender?.(); });
        } else if (preset === 'obxd_main_page') {
            /* page 1 = Main (root.knobs) */
            await page.evaluate(() => {
                globalThis.__movy_model?.changePage(1);
                globalThis.__movy_forceRender?.();
            });
        } else if (preset === 'obxd_filter_page') {
            /* page 3 = Filter (shows Cutoff/Resonance with fixed labels) */
            await page.evaluate(() => {
                globalThis.__movy_model?.changePage(3);
                globalThis.__movy_forceRender?.();
            });
        } else if (preset === 'chain_synth') {
            await page.evaluate(() => {
                globalThis.__movy_renderChainView?.(1, false);  /* synth, no toast */
            });
        } else if (preset === 'chain_empty') {
            await page.evaluate(() => {
                globalThis.__movy_renderChainView?.(2, false);  /* fx1 = empty slot */
            });
        } else if (preset === 'chain_jog_toast') {
            await page.evaluate(() => {
                globalThis.__movy_renderChainView?.(1, true);   /* synth + jog toast */
            });
        } else if (preset === 'knobs_jog_toast') {
            await page.evaluate(() => {
                globalThis.__movy_renderKnobsJogToast?.();
            });
        }

        /* Capture canvas at its native 128×64 resolution */
        const dataUrl = await page.evaluate(() => {
            return document.getElementById('display').toDataURL('image/png');
        });
        const pngBuf  = Buffer.from(dataUrl.split(',')[1], 'base64');
        const actual  = join(ACTUAL_DIR, `${preset}.png`);
        writeFileSync(actual, pngBuf);

        const baseline = join(BASE_DIR, `${preset}.png`);

        if (!existsSync(baseline) || UPDATE) {
            writeFileSync(baseline, pngBuf);
            console.log(UPDATE ? 'updated' : 'saved baseline');
            pass++;
        } else {
            const result = diffPngs(baseline, actual);
            if (result.different) {
                console.log(`FAIL (${result.reason ?? result.count + ' px differ'})`);
                fail++;
            } else {
                console.log('ok');
                pass++;
            }
        }
    }

    await browser.close();
    server.close();

    console.log(`\n  ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
