/* schwung-lib.ts — the ONE door to Schwung's param_pages.
 *
 * Every param_pages import movy makes is here, so the rest of movy reaches the
 * library through `schwungLib()` and never names a device path. movy ships the
 * PINNED tag's copy of these files (plans/2026-10-13-pin-schwung-js.md), so
 * they are always present and always that version: plain static imports, no
 * availability check, no fallback for an older Schwung.
 *
 * LITERAL PATHS: esbuild resolves only a specifier it can read at build time —
 * the browser build aliases them to the pinned tree, the device build keeps
 * them external and movy-host maps them onto the shipped copy.
 */

// @ts-ignore — absolute device path; external in the device build
import * as pc from '/data/UserData/schwung/shared/param_pages/page_controller.mjs';
// @ts-ignore
import * as pi from '/data/UserData/schwung/shared/param_pages/page_input.mjs';
// @ts-ignore
import * as rpm from '/data/UserData/schwung/shared/param_pages/render_page_movy.mjs';
// @ts-ignore
import * as el from '/data/UserData/schwung/shared/param_pages/enum_list.mjs';
// @ts-ignore
import * as wr from '/data/UserData/schwung/shared/param_pages/widget_registry.mjs';
// @ts-ignore
import * as vo from '/data/UserData/schwung/shared/param_pages/voices.mjs';
// @ts-ignore
import * as ck from '/data/UserData/schwung/shared/param_pages/child_key.mjs';
// @ts-ignore
import * as pm from '/data/UserData/schwung/shared/param_pages/param_meta.mjs';
// @ts-ignore
import * as pp from '/data/UserData/schwung/shared/param_pages/page_plan.mjs';
// @ts-ignore
import * as anm from '/data/UserData/schwung/shared/param_pages/anim_state.mjs';
/* Side effect only: registers the real file reader with wav_peaks.mjs. Without
 * it every sample cell caches "unreadable wav" (SP-42). */
// @ts-ignore
import '/data/UserData/schwung/shared/param_pages/wav_io_qjs.mjs';
// @ts-ignore
import * as wp from '/data/UserData/schwung/shared/param_pages/wav_peaks.mjs';
// @ts-ignore
import * as vz from '/data/UserData/schwung/shared/param_pages/viz.mjs';
// @ts-ignore
import * as lk from '/data/UserData/schwung/shared/param_pages/list_knob.mjs';
// @ts-ignore
import * as fc from '/data/UserData/schwung/shared/param_pages/frame_ctx.mjs';
// @ts-ignore
import * as rp from '/data/UserData/schwung/shared/param_pages/render_page.mjs';
// @ts-ignore
import * as lfo from '/data/UserData/schwung/shared/param_pages/lfo_page.mjs';
// @ts-ignore
import * as lvm from '/data/UserData/schwung/shared/lane_voice_map.mjs';
// @ts-ignore
import * as kdf from '/data/UserData/schwung/shared/param_pages/knob_direction_filter.mjs';

/** Everything movy uses from param_pages. Typed loosely on purpose: these are
 *  `.mjs` with no declarations, and inventing types here would be a second,
 *  drifting copy of Schwung's. */
export interface SchwungLib {
    createController: any; LAYOUT_MOVY: any; applyInput: any;
    renderPageMovy: any; BAND_H: any;
    /* "How full is this control" — the ring, the arc and the dot share it. */
    normalizedOf: any;
    drawFooter: any; isTurnable: any; KIND_ENUM: any;
    PAGE_KNOBS: any; PAGE_PRESET: any; PAGE_ITEMS: any; PAGE_MENU: any;
    drawEnumList: any;
    registerWidget: any; clearWidgets: any; isWidgetAvailable: any;
    padLayoutOf: any; focusParamOf: any; voicesOf: any; voiceIndexFromNote: any;
    focusPressParamOf: any; childPressParam: any;
    activity: any; buttonPhase: any;
    resolveChildKey: any; childCount: any;
    childIndexToWire: any; childIndexFromWire: any; childIndexParam: any;
    VIZ_SAMPLE: any; wavPeaksTick: any; wavPeaksDone: any;
    /* Read only by tests proving the envelope job filled in. */
    wavPeaks: any;
    /* A knob on a preset door steps the list with Schwung's own feel (SP-44). */
    listKnobInit: any; listKnobStep: any;
    /* Shift+knob 1 steps a preset door's BANK at the list's own detent rate,
     * and holds the read cursor off the index it wrote for as long as
     * stepPreset does. */
    DETENTS_PER_ENTRY: any; SETTLE_TICKS: any;
    fitHeadTail: any; frameCtx: any; enumIndexOf: any;
    /* The opt-in worn-encoder filter (midi/knob-direction.ts). */
    createKnobDirectionFilter: any; parseKnobFilterConfig: any; KNOB_FILTER_FLAG_PATH: any;
}

const lib: SchwungLib = {
    createController: pc.createController, LAYOUT_MOVY: pc.LAYOUT_MOVY,
    applyInput: pi.applyInput,
    renderPageMovy: rpm.renderPageMovy, BAND_H: rpm.BAND_H,
    normalizedOf: rpm.normalizedOf,
    drawFooter: rpm.drawFooter, isTurnable: pm.isTurnable, KIND_ENUM: pm.KIND_ENUM,
    PAGE_KNOBS: pp.PAGE_KNOBS, PAGE_PRESET: pp.PAGE_PRESET,
    PAGE_ITEMS: pp.PAGE_ITEMS, PAGE_MENU: pp.PAGE_MENU,
    drawEnumList: el.drawEnumList,
    registerWidget: wr.registerWidget, clearWidgets: wr.clearWidgets,
    isWidgetAvailable: wr.isWidgetAvailable,
    padLayoutOf: vo.padLayoutOf, focusParamOf: vo.focusParamOf,
    voicesOf: vo.voicesOf, voiceIndexFromNote: vo.voiceIndexFromNote,
    focusPressParamOf: vo.focusPressParamOf, childPressParam: ck.childPressParam,
    activity: anm.activity, buttonPhase: rpm.buttonPhase,
    resolveChildKey: ck.resolveChildKey, childIndexToWire: ck.childIndexToWire,
    childCount: ck.childCount,
    childIndexFromWire: ck.childIndexFromWire, childIndexParam: ck.childIndexParam,
    VIZ_SAMPLE: vz.VIZ_SAMPLE,
    wavPeaksTick: wp.wavPeaksTick, wavPeaksDone: wp.wavPeaksDone,
    wavPeaks: wp.wavPeaks,
    listKnobInit: lk.listKnobInit, listKnobStep: lk.listKnobStep,
    DETENTS_PER_ENTRY: lk.DETENTS_PER_ENTRY, SETTLE_TICKS: pc.SETTLE_TICKS,
    frameCtx: fc.frameCtx,
    enumIndexOf: pm.enumIndexOf,
    fitHeadTail: rp.fitHeadTail,
    createKnobDirectionFilter: kdf.createKnobDirectionFilter,
    parseKnobFilterConfig: kdf.parseKnobFilterConfig,
    KNOB_FILTER_FLAG_PATH: kdf.KNOB_FILTER_FLAG_PATH,
};

export function schwungLib(): SchwungLib { return lib; }

/*
 * SCHWUNG'S OWN LFO PAGE — the contract its Slot Settings and Master FX
 * Settings grids draw their LFO 1 / LFO 2 pages from. movy's LFO chain slot
 * edits those same LFOs, so it draws THAT page (SP-60).
 */
/** One LFO's routings as a flat enum — `lfoTargetOptions`' answer. */
export interface LfoTargetList {
    options: string[];
    short_options: string[];
    routes: { target: string; param: string }[];
}

export interface SchwungLfoPage {
    lfoParams(lfoIndex: number, keyPrefix?: string, opts?: { targets?: LfoTargetList | null }): any[];
    lfoLevels(indices: number[], keyPrefix?: string): Record<string, any>;
    lfoTargetOptions(a: { components: { key: string; label: string }[];
                          paramsFor: (key: string) => { key: string; label: string }[];
                          current?: { target: string; param: string } | null }): LfoTargetList;
    lfoTargetIndex(routes: LfoTargetList['routes'], target: string, param: string): number;
}

const lfoPage: SchwungLfoPage = {
    lfoParams: lfo.lfoParams, lfoLevels: lfo.lfoLevels,
    lfoTargetOptions: lfo.lfoTargetOptions, lfoTargetIndex: lfo.lfoTargetIndex,
};

export function schwungLfoPage(): SchwungLfoPage { return lfoPage; }

/*
 * WHICH KEYS ARE WHICH DRUM VOICE'S — Schwung's `laneVoiceMap` (plan D16), the
 * map its own chain uses for Move's per-voice paste. Taken whole so there is
 * one definition of "a pad's keys": the module's declaration.
 */
export function schwungLaneVoiceMap(): (hierarchy: any) => string { return lvm.laneVoiceMap; }
