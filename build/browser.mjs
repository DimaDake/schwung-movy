// Bundles model + renderer entry points -> dist/esm/ for browser tests.
// Code splitting puts shared code in chunk files; JSON configs are inlined.
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');

await esbuild.build({
    entryPoints: [
        resolve(root, 'src/model/index.ts'),
        /* Entry points so the browser tests can toggle the grid and call the
         * adapter directly; without these esbuild folds them into a chunk and
         * there is no dist/esm/renderer/schwung-flag.js to import. */
        resolve(root, 'src/renderer/schwung-flag.ts'),
        resolve(root, 'src/renderer/schwung-body.ts'),
        resolve(root, 'src/renderer/schwung-page.ts'),
        resolve(root, 'src/renderer/schwung-grid.ts'),
        resolve(root, 'src/model/envelope.ts'),
        resolve(root, 'src/model/lfo-viz.ts'),
        resolve(root, 'src/model/page-layout.ts'),
        resolve(root, 'src/model/lfo-vm.ts'),
        resolve(root, 'src/model/lfo-shapes.ts'),
        resolve(root, 'src/model/filter-viz.ts'),
        resolve(root, 'src/model/filter-vm.ts'),
        resolve(root, 'src/model/filter-mode.ts'),
        resolve(root, 'src/model/enum-class.ts'),
        resolve(root, 'src/model/fader.ts'),
        resolve(root, 'src/model/wave-viz.ts'),
        resolve(root, 'src/model/wave-toggle.ts'),
        resolve(root, 'src/model/env-stage.ts'),
        resolve(root, 'src/model/eq-viz.ts'),
        resolve(root, 'src/model/eq-vm.ts'),
        resolve(root, 'src/renderer/eq-curve.ts'),
        resolve(root, 'src/renderer/filter-curve.ts'),
        resolve(root, 'src/model/cut-viz.ts'),
        resolve(root, 'src/renderer/cut-curve.ts'),
        resolve(root, 'src/model/wav-viz.ts'),
        resolve(root, 'src/model/wav-peaks.ts'),
        resolve(root, 'src/renderer/wav-form.ts'),
        resolve(root, 'src/modules/loader.ts'),
        resolve(root, 'src/model/viewmodel.ts'),
        resolve(root, 'src/model/store.ts'),
        resolve(root, 'src/model/knob-step.ts'),
        resolve(root, 'src/model/step-labels.ts'),
        resolve(root, 'src/model/trigger.ts'),
        resolve(root, 'src/model/toggle.ts'),        resolve(root, 'src/model/constants.ts'),
        resolve(root, 'src/model/enum-value.ts'),
        resolve(root, 'src/model/meta-infer.ts'),
        resolve(root, 'src/model/file-validate.ts'),
        resolve(root, 'src/model/pad-scope.ts'),
        resolve(root, 'src/renderer/knob-view.ts'),
        resolve(root, 'src/renderer/knob.ts'),
        resolve(root, 'src/renderer/header.ts'),
        resolve(root, 'src/renderer/shorten.ts'),
        resolve(root, 'src/renderer/keys-view.ts'),
        resolve(root, 'src/renderer/browse-view.ts'),
        resolve(root, 'src/renderer/chain-view.ts'),
        resolve(root, 'src/renderer/lfo-wave.ts'),
        resolve(root, 'src/renderer/overlay.ts'),
        resolve(root, 'src/renderer/leave-modal-view.ts'),
        resolve(root, 'src/renderer/volume-overlay.ts'),
        resolve(root, 'src/renderer/capture-overlay.ts'),
        resolve(root, 'src/renderer/undo-overlay.ts'),
        resolve(root, 'src/undo/state.ts'),
        resolve(root, 'src/undo/group.ts'),
        resolve(root, 'src/undo/record.ts'),
        resolve(root, 'src/undo/apply.ts'),
        resolve(root, 'src/undo/verbs.ts'),
        resolve(root, 'src/undo/label.ts'),
        resolve(root, 'src/undo/toast.ts'),
        resolve(root, 'src/undo/module-dump.ts'),
        resolve(root, 'src/undo/module-apply.ts'),
        resolve(root, 'src/undo/rec-pass.ts'),
        resolve(root, 'src/undo/param-sync.ts'),
        resolve(root, 'src/undo/edit.ts'),
        resolve(root, 'src/undo/ui-fields.ts'),
        resolve(root, 'src/chain/set-param.ts'),
        resolve(root, 'src/mixer/track-volume.ts'),
        resolve(root, 'src/mixer/track-mutes.ts'),
        resolve(root, 'src/seq/leds.ts'),
        resolve(root, 'src/seq/led-cache.ts'),
        resolve(root, 'src/seq/button-held.ts'),
        resolve(root, 'src/seq/buttons.ts'),
        resolve(root, 'src/seq/colors.ts'),
        resolve(root, 'src/keyboard/drum-handler.ts'),
        resolve(root, 'src/keyboard/layouts.ts'),
        resolve(root, 'src/keyboard/state.ts'),
        resolve(root, 'src/keyboard/held-notes.ts'),
        resolve(root, 'src/keyboard/release.ts'),
        resolve(root, 'src/keyboard/handler.ts'),
        resolve(root, 'src/app/globals.ts'),
        resolve(root, 'src/app/init.ts'),
        resolve(root, 'src/app/resume.ts'),
        resolve(root, 'src/app/unload.ts'),
        resolve(root, 'src/renderer/knob-leds.ts'),
        resolve(root, 'src/app/leave-modal.ts'),
        resolve(root, 'src/app/jog-hint.ts'),
        resolve(root, 'src/app/perf-probe.ts'),
        resolve(root, 'src/app/debug.ts'),
        resolve(root, 'src/chain/config.ts'),
        resolve(root, 'src/lfo/params.ts'),
        resolve(root, 'src/lfo/model.ts'),
        resolve(root, 'src/lfo/assign.ts'),
        resolve(root, 'src/lfo/assign-mode.ts'),
        resolve(root, 'src/lfo/scope.ts'),
        resolve(root, 'src/lfo/cells.ts'),
        resolve(root, 'src/lfo/io.ts'),
        resolve(root, 'src/lfo/inert.ts'),
        resolve(root, 'src/track/lfo-persist.ts'),
        resolve(root, 'src/font/big.ts'),
        resolve(root, 'src/font/index.ts'),
        resolve(root, 'src/font/index5x3.ts'),
        resolve(root, 'src/font/glyphs5x3.ts'),
        resolve(root, 'src/seq/engine.ts'),
        resolve(root, 'src/seq/automation.ts'),
        resolve(root, 'src/seq/router.ts'),
        resolve(root, 'src/seq/router-steps.ts'),
        resolve(root, 'src/seq/router-buttons.ts'),
        resolve(root, 'src/seq/router-pads.ts'),
        resolve(root, 'src/seq/state.ts'),
        resolve(root, 'src/seq/leds.ts'),
        resolve(root, 'src/seq/led-cache.ts'),
        resolve(root, 'src/seq/button-held.ts'),
        resolve(root, 'src/seq/buttons.ts'),
        resolve(root, 'src/seq/constants.ts'),
        resolve(root, 'src/seq/colors.ts'),
        resolve(root, 'src/seq/scales.ts'),
        resolve(root, 'src/seq/render.ts'),
        resolve(root, 'src/seq/pads.ts'),
        resolve(root, 'src/seq/loop-mode.ts'),
        resolve(root, 'src/seq/step-edit.ts'),
        resolve(root, 'src/seq/step-rec.ts'),
        resolve(root, 'src/seq/step-rec-view.ts'),
        resolve(root, 'src/seq/step-page.ts'),
        resolve(root, 'src/seq/param-vm.ts'),
        resolve(root, 'src/seq/step-page-vm.ts'),
        resolve(root, 'src/seq/edit-ops.ts'),
        resolve(root, 'src/seq/duplicate.ts'),
        resolve(root, 'src/seq/session.ts'),
        resolve(root, 'src/seq/persist-blob.ts'),
        resolve(root, 'src/seq/persist-store.ts'),
        resolve(root, 'src/seq/set-load.ts'),
        resolve(root, 'src/seq/set-save.ts'),
        resolve(root, 'src/seq/set-session.ts'),
        resolve(root, 'src/seq/set-fail.ts'),
        resolve(root, 'src/renderer/loading-view.ts'),
        resolve(root, 'src/seq/set-inherit.ts'),
        resolve(root, 'src/seq/ui-state.ts'),
        resolve(root, 'src/seq/set-context.ts'),
        resolve(root, 'src/seq/held.ts'),
        resolve(root, 'src/seq/buttons.ts'),
        resolve(root, 'src/keyboard/leds.ts'),
        resolve(root, 'src/app/state.ts'),
        resolve(root, 'src/model/state.ts'),
        resolve(root, 'src/track/ref.ts'),
        resolve(root, 'src/track/registry.ts'),
        resolve(root, 'src/track/focus.ts'),
        resolve(root, 'src/track/switch.ts'),
        resolve(root, 'src/track/bulk.ts'),
        resolve(root, 'src/track/pad-route.ts'),
        resolve(root, 'src/track/chain-persist.ts'),
        resolve(root, 'src/track/host-mode.ts'),
        resolve(root, 'src/browser/handler.ts'),
        resolve(root, 'src/browser/state.ts'),
        resolve(root, 'src/seq/track-select.ts'),
        resolve(root, 'src/seq/momentary.ts'),
        resolve(root, 'src/seq/detent.ts'),
        resolve(root, 'src/seq/param-page.ts'),
        resolve(root, 'src/seq/main-page.ts'),
        resolve(root, 'src/seq/main-page-vm.ts'),
        resolve(root, 'src/seq/tempo-override.ts'),
        resolve(root, 'src/seq/capture.ts'),
        resolve(root, 'src/seq/capture-vm.ts'),
        resolve(root, 'src/seq/clip-scale.ts'),
        resolve(root, 'src/seq/clip-page.ts'),
        resolve(root, 'src/seq/clip-page-vm.ts'),
        resolve(root, 'src/seq/drum-sync.ts'),
        resolve(root, 'src/seq/quant.ts'),
        resolve(root, 'src/seq/prefs.ts'),
        resolve(root, 'src/seq/quant-overlay.ts'),
        resolve(root, 'src/seq/flags-def.ts'),
        resolve(root, 'src/seq/flags.ts'),
        resolve(root, 'src/seq/flags-page.ts'),
        resolve(root, 'src/seq/flags-page-vm.ts'),
        resolve(root, 'src/renderer/flags-view.ts'),
        resolve(root, 'src/renderer/value-row.ts'),
        resolve(root, 'src/renderer/quant-overlay.ts'),
    ],
    bundle:    true,
    splitting: true,
    /* chain/master-mirror.ts imports shadow_ui.js's context by its absolute
     * device path, which the device build leaves external. Off device there is
     * no such file, so point it at a recording stub instead — that is what makes
     * the master-FX mirror resync assertable in logic.mjs. An onResolve plugin
     * rather than `alias`, which rejects absolute paths as alias names. Remove
     * with master-mirror.ts. */
    plugins: [{
        name: 'shadow-ctx-stub',
        setup(build) {
            build.onResolve({ filter: /shadow_ui_ctx\.mjs$/ }, () => ({
                path: resolve(root, 'browser-test/stubs/shadow_ui_ctx.mjs'),
            }));
        },
    }, {
        /* renderer/schwung-body.ts imports Schwung's shared param_pages by its
         * absolute device path, which the device build leaves external (it is
         * already in build/device.mjs's `external` list, alongside
         * constants.mjs and input_filter.mjs). Off device there is no such
         * file, so point it at a real schwung checkout — that is what lets the
         * browser tests render the actual Schwung widgets rather than a stub.
         *
         * SCHWUNG is optional: without it the import resolves to a stub that
         * throws only if the grid is switched on, so the whole existing suite
         * still builds and runs on a machine with no schwung checkout. */
        name: 'schwung-param-pages',
        setup(build) {
            const SCHWUNG = process.env.SCHWUNG;
            build.onResolve({ filter: /^\/data\/UserData\/schwung\/shared\/param_pages\// }, (a) => {
                if (SCHWUNG) {
                    const tail = a.path.replace('/data/UserData/schwung/', '');
                    return { path: resolve(SCHWUNG, 'src/' + tail) };
                }
                return { path: resolve(root, 'browser-test/stubs/schwung-param-pages.mjs') };
            });
        },
    }],
    /* Tests exercise the debug-only surfaces, so they build with the gate ON —
     * a suite that compiled them out would assert nothing about them. */
    define:    { __MOVY_DEBUG__: 'true' },
    outdir:    resolve(root, 'dist/esm'),
    outbase:   resolve(root, 'src'),
    format:    'esm',
    target:    ['es2020'],
    logLevel:  'info',
});
console.log('Browser modules written: dist/esm/');
