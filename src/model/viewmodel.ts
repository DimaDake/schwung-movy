import type { ViewModel, AutomationView, EnvelopeVM, LfoVizVM } from '../types/viewmodel.js';
import type { ModelState } from './state.js';
import { formatValue, paramIoKey, paramAutomatable } from './store.js';
import { planPageLayout, claimedCells } from './page-layout.js';
import { waveCellIndices } from './wave-viz.js';
import { waveToggleCells } from './wave-toggle.js';
import { envStageCells } from './env-stage.js';
import { enumClassOf } from './enum-class.js';
import { buildLfoViz } from './lfo-vm.js';
import { buildFilterViz } from './filter-vm.js';
import { buildEqViz } from './eq-vm.js';
import { cutKindOf } from './cut-viz.js';
import { wavPeaks, resamplePeaks } from './wav-peaks.js';
import { KNOBS_PER_PAGE, KNOBS_PER_ROW } from './constants.js';
import { dedupShortNames } from '../renderer/shorten.js';
import { basename } from './path.js';
import { triggerVisual } from './trigger.js';

/* No-automation default so callers that don't care (browser tests, non-seq
 * views) need not build a snapshot. */
const NO_AUTOMATION: AutomationView = {
    assignedLanes: 0, activeLanes: 0, held: false, poolFull: false,
    heldValues: new Map(), liveValues: new Map(), laneForKey: () => -1,
};

/* Glyph ids for the open enum overlay's option list, or null when that param is
 * not a qualifying waveform enum. The overlay owns the param's global index, so
 * this needs no page arithmetic. */
function overlayShapeIds(s: ModelState): number[] | null {
    const p = s.enumOverlay ? s.knobParams[s.enumOverlay.gi] : null;
    return p ? enumClassOf(p).shapeIds : null;
}

export function buildViewModel(s: ModelState, auto: AutomationView = NO_AUTOMATION): ViewModel {
    const nBanks = Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE));

    let bankName = '';
    if (s.bankNames.length > 1 && s.bankNames[s.knobPage]) {
        bankName = s.bankNames[s.knobPage];
    } else if (s.moduleConfig && s.moduleConfig.banks[s.knobPage]) {
        bankName = s.moduleConfig.banks[s.knobPage].name;
    } else if (nBanks > 1) {
        bankName = s.knobPage === 0 ? 'Main' : 'Page ' + s.knobPage;
    }

    const pageStart   = s.knobPage * KNOBS_PER_PAGE;
    const pageEntries = Array.from({ length: KNOBS_PER_PAGE }, (_, i) => {
        const p = s.knobParams[pageStart + i];
        return p ? { label: p.label, shortLabel: p.shortLabel ?? null } : null;
    });
    const shortNames = dedupShortNames(pageEntries, 5);

    const layout = planPageLayout(s.knobParams.slice(pageStart, pageStart + KNOBS_PER_PAGE));
    /* Cells whose enum draws as a waveform silhouette instead of option text.
     * Per-cell, so unlike the groups above it does not touch the layout. */
    const pageSlice = s.knobParams.slice(pageStart, pageStart + KNOBS_PER_PAGE);
    const waveCells = waveCellIndices(pageSlice, layout);
    /* Binary "is this waveform sounding?" switches — drawn as the silhouette,
     * dotted when off, instead of an on/off bar that says nothing about shape. */
    const claimed = claimedCells(layout);
    const waveToggles = waveToggleCells(pageSlice, claimed);
    /* Lone Attack/Decay knobs, drawn as a single ramp. Sound generators only:
     * a reverb's "Decay" is a tail length, and an FX chain full of envelope
     * ramps would say the wrong thing about what those knobs do. */
    const envStages = s.componentKey === 'synth'
        ? envStageCells(pageSlice, claimed)
        : new Map<number, import('./env-stage.js').EnvStage>();
    /* A LONE low/high cut draws its single corner in its own cell. The paired
     * case is a two-cell graphic placed by the layout, so those cells are in
     * `claimed` and never reach here. */
    const loneCuts = new Map<number, import('./cut-viz.js').CutKind>();
    pageSlice.forEach((p, i) => {
        if (!p || claimed.has(i)) return;
        const k = cutKindOf(p);
        if (k) loneCuts.set(i, k);
    });
    const rows: ViewModel['rows'] = [[null, null, null, null], [null, null, null, null]];
    const envelopeLines: (EnvelopeVM | null)[] = [null, null];
    for (const e of layout.envelopes)
        envelopeLines[e.line] = { name: e.name, startCol: e.startCol, cellCount: e.cellCount, roles: e.roles.join('') };

    // LFO modulation marks — read from the cached target set (refreshed on the
    // poll cadence in processTick), so this does no per-render IPC.
    const isModulated = (p: import('../types/param.js').KnobParam): boolean =>
        s.modulatedKeys.size > 0 && s.modulatedKeys.has(paramIoKey(s, p));

    for (const cell of layout.cells) {
        const localIdx   = cell.idx;                          // page-relative param index
        const screenSlot = cell.line * KNOBS_PER_ROW + cell.col;  // physical knob position
        const gi    = pageStart + localIdx;
        const p     = s.knobParams[gi];
        if (!p) continue;
        const v  = s.knobValues[gi];
        const renorm = (val: number) => (p.min === p.max)
            ? 0 : Math.max(0, Math.min(1, (val - p.min) / (p.max - p.min)));
        const nv = (v === null || v === undefined) ? 0 : renorm(v);
        const enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
        const dv = p.type === 'file'
            ? (s.fileValues[gi] ? basename(s.fileValues[gi] as string) : '—')
            : p.nameKey
                ? (s.port.getParam(s.componentKey + ':' + p.nameKey) ?? formatValue(p, v))
                : formatValue(p, v);
        const lane = auto.laneForKey(p.key);
        const automated = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
        // An automation edit drives BOTH the value text (inverted, like a knob
        // touch) and the arc/envelope position, so editing automation looks like
        // normal value editing — without touching the base value. Held step:
        // show that step's locked value. Live record: follow the knob while it's
        // being turned (cleared on release → snaps to base).
        let touched = s.touchedSlots.includes(screenSlot);
        let displayValue = dv;
        let arcValue = nv;
        if (auto.held && lane >= 0 && auto.heldValues.has(lane)) {
            const hv = auto.heldValues.get(lane) as number;
            touched = true; displayValue = formatValue(p, hv); arcValue = renorm(hv);
        } else if (!auto.held && lane >= 0 && auto.liveValues.has(lane)) {
            const lv = auto.liveValues.get(lane) as number;
            touched = true; displayValue = formatValue(p, lv); arcValue = renorm(lv);
        }
        rows[cell.line][cell.col] = {
            shortName:       shortNames[localIdx],
            fullName:        p.label,
            type:            p.type,
            normalizedValue: arcValue,
            displayValue,
            touched,
            isLongEnum:      p.type === 'enum' && (p.options?.length ?? 0) > 6,
            options:         p.options,
            enumIndex:       enumIdx,
            renderStyle:     (waveCells.has(localIdx) || waveToggles.has(localIdx))
                ? 'wave'
                : envStages.has(localIdx) ? 'envstage'
                : loneCuts.has(localIdx) ? 'cut' : p.renderStyle,
            ...(envStages.has(localIdx) ? { envStage: envStages.get(localIdx) } : {}),
            ...(loneCuts.has(localIdx) ? { cutKind: loneCuts.get(localIdx) } : {}),
            /* enumClass is already populated by the waveCellIndices call above,
             * so this is a cached array index, not a per-frame name lookup. */
            ...(waveCells.has(localIdx)
                ? { waveShape: (p.enumClass?.shapeIds ?? [])[enumIdx] ?? 10 }
                : {}),
            ...(waveToggles.has(localIdx)
                ? (() => {
                    const t = waveToggles.get(localIdx) as import('./wave-toggle.js').WaveToggle;
                    /* A Mute reads the other way round: its ON value is silent. */
                    const on = (v === null || v === undefined ? 0 : Math.round(v)) > 0;
                    return { waveShape: t.shape, waveOff: t.invert ? on : !on };
                })()
                : {}),
            automated,
            automatable:     paramAutomatable(s, p),
            assigned:        lane >= 0,
            modulated:       isModulated(p),
            ...(p.behavior === 'trigger'
                ? (() => { const t = triggerVisual(s, p.key); return { trigger: t.phase, triggerCool: t.coolSteps, triggerBlink: t.blinkOn }; })()
                : {}),
        };
    }

    // LFO/filter graphics read the page values — but overlaid with the live
    // automation value being edited (held-step lock or live take), so the curve/
    // waveform tracks an automation edit the same way the knob label does.
    const pageParams = s.knobParams.slice(pageStart, pageStart + KNOBS_PER_PAGE);
    const autoValue = (p: import('../types/param.js').KnobParam | null, base: number | null): number | null => {
        if (!p) return base;
        const lane = auto.laneForKey(p.key);
        if (lane < 0) return base;
        if (auto.held && auto.heldValues.has(lane)) return auto.heldValues.get(lane) as number;
        if (!auto.held && auto.liveValues.has(lane)) return auto.liveValues.get(lane) as number;
        return base;
    };
    const pageValues = pageParams.map((p, i) => autoValue(p, s.knobValues[pageStart + i]));
    const allValues  = s.knobParams.map((p, i) => autoValue(p, s.knobValues[i]));
    const lfoViz = buildLfoViz(layout.lfos, pageParams, pageValues);
    // Filter-response groups: cutoff+resonance drawn as a curve. Mode may live on
    // another page, so the resolver also reads the full cached param/value lists.
    const filterViz = buildFilterViz(layout.filters, pageParams, pageValues, s.knobParams, allValues);
    const eqViz = buildEqViz(layout.eqs, pageParams, pageValues);
    /* A cut pair is one band-pass across two cells; the normalised corner comes
     * from the same renorm the arc would have used. */
    const norm01 = (i: number): number => {
        const p = pageParams[i]; const v = pageValues[i];
        if (!p || v === null || v === undefined || p.max === p.min) return 0;
        return Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
    };
    /* Sample waveform. The peaks come from the cache only — the read itself is
     * chunked across ticks in processTick, so this stays allocation-light and
     * never touches the filesystem on a render. */
    const wavViz: import('../types/viewmodel.js').WavVizVM[] = layout.wavs.map((wv) => {
        /* The file is the one absorbed index that is neither a marker nor the
         * spread — picking "the first index that is not the position" started
         * returning a loop bound (or the spray) once the group grew. */
        const notFile = new Set<number>(wv.markers.map((m) => m.idx));
        if (wv.spray !== null) notFile.add(wv.spray);
        const fileIdx = wv.idxs.find((i) => !notFile.has(i));
        const path = fileIdx === undefined ? null : (s.fileValues[pageStart + fileIdx] ?? null);
        const width = wv.cellCount * 32;
        s.wavRequest = path ? { path, width } : null;
        const pk = wavPeaks(path);
        const at = (kind: string): number | undefined => {
            const mk = wv.markers.find((m) => m.kind === kind);
            return mk ? norm01(mk.idx) : undefined;
        };
        return {
            line: wv.line, startCol: wv.startCol, cellCount: wv.cellCount,
            points: pk ? resamplePeaks(pk.points, width) : [],
            gain: pk && pk.peak > 0 ? 1 / pk.peak : 1,
            position: norm01(wv.position),
            loopStart: at('loopStart'),
            loopEnd: at('loopEnd'),
            ...(wv.spray === null ? {} : { spray: norm01(wv.spray) }),
        };
    });
    /* Lone marker that kept its own cell: same graphic, one cell wide, at
     * whatever column the layout ended up giving it. */
    if (layout.wavCell !== null) {
        const cell = layout.cells.find((c) => c.idx === layout.wavCell);
        const marker = pageSlice[layout.wavCell];
        const named = marker?.filepathParam;
        const fileIdx = named
            ? pageSlice.findIndex((p) => p?.key === named)
            : pageSlice.findIndex((p) => p?.type === 'file');
        const path = fileIdx < 0 ? null : (s.fileValues[pageStart + fileIdx] ?? null);
        if (cell) {
            /* The group never got a line, but the page may still have left the
             * sample sitting immediately to the marker's left — mrsample's ADSR
             * and filter take both lines and push the pair to the end of one.
             * Span both cells when that happens; it is the same graphic, twice
             * the resolution, and the file cell was only showing a truncated
             * path anyway. */
            const fileCell = layout.cells.find((c) => c.idx === fileIdx);
            const joined = !!fileCell && fileCell.line === cell.line && fileCell.col === cell.col - 1;
            const startCol = joined ? fileCell.col : cell.col;
            const cellCount = joined ? 2 : 1;
            const width = cellCount * 32;
            s.wavRequest = path ? { path, width } : null;
            const pk = wavPeaks(path);
            wavViz.push({
                line: cell.line, startCol, cellCount,
                points: pk ? resamplePeaks(pk.points, width) : [],
                gain: pk && pk.peak > 0 ? 1 / pk.peak : 1,
                position: norm01(layout.wavCell),
            });
        }
    }
    const cutViz = layout.cuts.map((c) => ({
        line: c.line, startCol: c.startCol, cellCount: c.cellCount,
        lowcut: norm01(c.lowcut), highcut: norm01(c.highcut),
    }));

    // Toast follows the physical knob last touched → its displayed param (the
    // rearrange means screen slot ≠ page index).
    const slotMap = new Array(KNOBS_PER_PAGE).fill(-1);
    for (const c of layout.cells) slotMap[c.line * KNOBS_PER_ROW + c.col] = c.idx;
    const primary = s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
    let toast: ViewModel['toast'] = null;
    if (primary >= 0 && slotMap[primary] >= 0) {
        const gi = pageStart + slotMap[primary];
        const p  = s.knobParams[gi];
        if (p) {
            let tv: string;
            if (p.type === 'file') {
                tv = s.fileValues[gi] ? basename(s.fileValues[gi] as string) : '—';
            } else if (p.nameKey) {
                tv = s.port.getParam(s.componentKey + ':' + p.nameKey) ?? formatValue(p, s.knobValues[gi]);
            } else {
                tv = formatValue(p, s.knobValues[gi]);
            }
            /* A trigger's value is permanently "idle" — printing it in the toast
             * is the same misleading "you failed to change it" message the badge
             * exists to remove. Report the action's state instead. */
            if (p.behavior === 'trigger') {
                const phase = triggerVisual(s, p.key).phase;
                tv = phase === 'fired' ? 'FIRED' : phase === 'cooling' ? 'BUSY' : 'READY';
            }
            toast = { fullName: p.label, value: tv, browseHint: p.type === 'file' };
        }
    }

    return {
        moduleName:     s.activeModuleName,
        bankName,
        bankIndex:      s.knobPage,
        bankCount:      nBanks,
        bankGroups:     s.bankGroups,
        rows,
        envelopeLines,
        touchedSlot:    primary >= 0 ? primary : null,
        toast,
        overlay: s.enumOverlay
            ? {
                slot: s.enumOverlay.slot,
                options: s.enumOverlay.options,
                selected: s.enumOverlay.selected,
                /* Read straight off the cached EnumClass — resolving a 64-entry
                 * option list per frame is what enum-class.ts exists to avoid. */
                shapeIds: overlayShapeIds(s),
              }
            : s.fileOverlay
            ? {
                slot: s.fileOverlay.slot, options: s.fileOverlay.labels,
                selected: s.fileOverlay.selected, shapeIds: null,
              }
            : null,
        isEmpty:        s.moduleId === '' && s.activeModuleName === '—',
        drumPadCount:       s.drumPadCount,
        drumCurrentPad:     s.drumCurrentPad,
        drumCurrentPhysPad: s.drumCurrentPhysPad,
        /* Pad-scoped either way: a bank that re-targets by pad, or a config
         * where a pad chooses the page. In both the header icon answers the
         * same question — which voice is under the knobs — and without it a
         * per-voice-page kit gives no on-screen clue at all. */
        isPadScoped:        !!(s.moduleConfig?.banks[s.knobPage]?.padSpecific)
                            || !!s.moduleConfig?.banks.some(b => b.pad !== undefined),
        automationHeld:     auto.held,
        automationPoolFull: auto.poolFull,
        stepPagePresent:    false,
        stepPageSelected:   false,
        lfoViz:             lfoViz.length ? lfoViz : undefined,
        filterViz:          filterViz.length ? filterViz : undefined,
        eqViz:              eqViz.length ? eqViz : undefined,
        cutViz:             cutViz.length ? cutViz : undefined,
        wavViz:             wavViz.length ? wavViz : undefined,
    };
}
