/* What an automation lane writes, told to the engine when the lane is bound.
 *
 * The engine writes each lane value straight to its param (`ch<N>:lane`, see
 * engine/crates/movy-dsp/src/auto_lane.rs) — no CC, no chain knob mapping, and
 * no 256-entry chain param table that a template rack's per-pad key could be
 * missing from. The engine cannot know a param's range or type, so the bind
 * carries them; it is re-sent on every label sync, which is what keeps it
 * right across an engine restart, a Set load and an undo.
 *
 * A mix param is not a chain param at all: the lane drives movy's own mixer
 * (`MixField` in engine/crates/movy-dsp/src/mixer.rs).
 *
 * Extracted from the router's inline callback so the choice is testable: a
 * bind issued with the wrong form works perfectly, on nothing. */

import type { KnobParamInfo } from '../model/store.js';

/** The component key a MIX page's params report. */
export const MIX_TARGET = 'mix';

/** What a bind needs to know about a lane's param. `LaneEntry` is one. */
export interface LaneBindInfo {
    targetParam: string;   // "synth:cutoff", "mix:send1"
    min: number;
    max: number;
    type: string;
    /* An enum's option names, and whether the module reads them by NAME. An
     * enum the module reads by index needs only the count. */
    options?: string[];
    wiresNames?: boolean;
}

export function isMixParam(info: KnobParamInfo): boolean {
    return info.target === MIX_TARGET;
}

/** Whether a lane's target is a mix param, from its `target:param` string. */
export function isMixTarget(targetParam: string): boolean {
    return targetParam.startsWith(MIX_TARGET + ':');
}

/** The `ch<N>:lane` value that binds `lane` to `e`, or null when the param
 *  cannot be written in a form the engine can produce. */
export function laneBindSpec(lane: number, e: LaneBindInfo): string | null {
    const sep = e.targetParam.indexOf(':');
    if (sep <= 0 || sep === e.targetParam.length - 1) return null;
    if (isMixTarget(e.targetParam)) return lane + '|m|' + e.targetParam.slice(sep + 1);
    if (e.type === 'enum' && e.options && e.options.length > 0) {
        if (!e.wiresNames) return lane + '|e|' + e.options.length + '|' + e.targetParam;
        // `|` separates the fields; an option name holding one cannot be sent.
        if (e.options.some((o) => o.indexOf('|') >= 0)) return null;
        return lane + '|n|' + e.targetParam + '|' + e.options.join('|');
    }
    if (!isFinite(e.min) || !isFinite(e.max)) return null;
    const kind = e.type === 'int' || e.type === 'enum' || e.type === 'bool' ? 'i' : 'f';
    return lane + '|' + kind + '|' + e.min + '|' + e.max + '|' + e.targetParam;
}

/** Bind `lane` to `e` through `write` (a track port's `setParam`). The one
 *  writer, so the assign, restore and undo paths cannot drift apart. */
export function bindLane(
    write: (key: string, val: string) => boolean,
    lane: number, e: LaneBindInfo,
): boolean {
    const spec = laneBindSpec(lane, e);
    return spec !== null && write('lane', spec);
}

/** Bind several lanes of one track in a single write. Each param write is a
 *  blocking round trip (~one audio frame), and a label sync re-binds every
 *  lane, so one write per lane stalled the UI once per lane. Returns how many
 *  lanes were refused (and so not sent). */
export function bindLanes(
    write: (key: string, val: string) => boolean,
    lanes: { lane: number, e: LaneBindInfo }[],
): number {
    const specs: string[] = [];
    for (const { lane, e } of lanes) {
        const spec = laneBindSpec(lane, e);
        if (spec !== null) specs.push(spec);
    }
    if (specs.length > 0) write('lanes', specs.join('\n'));
    return lanes.length - specs.length;
}

/** The bind for a lane assigned from the knob under the hand. */
export function bindInfoOf(info: KnobParamInfo): LaneBindInfo {
    return {
        targetParam: info.target + ':' + info.ioKey,
        min: info.min, max: info.max, type: info.type,
        options: info.options, wiresNames: info.wiresNames,
    };
}

/** `setMapping` for `assignLane`: binds the lane to the knob's param. */
export function mappingFor(
    info: KnobParamInfo,
    write: (key: string, val: string) => boolean,
): (lane: number) => boolean {
    return (lane) => bindLane(write, lane, bindInfoOf(info));
}
