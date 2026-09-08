/* Which mapping an automation lane needs, decided by what the param IS.
 *
 * A module param is mapped inside the chain (`knob_<N>_set`), and the CC the
 * engine emits for the lane lands on it. A mix param has no chain-host param to
 * land on — `knob_find_param` resolves only components inside the chain — so
 * the lane is declared to movy's own mixer instead and the engine writes the
 * field directly (see `MixField` in engine/crates/movy-dsp/src/mixer.rs).
 *
 * Extracted from the router's inline callback so the choice is testable: a
 * mapping issued to the wrong key works perfectly, on nothing. */

import type { KnobParamInfo } from '../model/store.js';

/** The component key a MIX page's params report. */
export const MIX_TARGET = 'mix';

export function isMixParam(info: KnobParamInfo): boolean {
    return info.target === MIX_TARGET;
}

/** The engine key + value that releases lane `lane` back to the chain. */
export function mixLaneClear(lane: number): [string, string] {
    return ['mixlane', lane + ',-'];
}

/** `setMapping` for `assignLane`: issues whichever mapping this param needs. */
export function mappingFor(
    info: KnobParamInfo,
    write: (key: string, val: string) => boolean,
): (lane: number) => boolean {
    return (lane) => applyLaneMapping(write, lane, info.target + ':' + info.ioKey);
}

/** Map `lane` to `targetParam` (`mix:send1`, `synth:cutoff`), whichever kind it
 *  is. The one writer, so the restore and verify paths cannot drift from the
 *  assign path — both used to hard-code `knob_<N>_set`, which would have
 *  re-applied a mix lane as a chain mapping that silently does nothing. */
export function applyLaneMapping(
    write: (key: string, val: string) => boolean,
    lane: number, targetParam: string,
): boolean {
    const sep = targetParam.indexOf(':');
    const target = targetParam.slice(0, sep);
    const param = targetParam.slice(sep + 1);
    if (target === MIX_TARGET) {
        return write('mixlane', lane + ',' + param);
    }
    /* Release any mix binding this lane still carries before giving it to the
     * chain. A lane reassigned from a send to a module param would otherwise
     * keep being swallowed by the mixer, and the module param would never move
     * — with a lane, a label and a drawn arc all saying it should. */
    write(...mixLaneClear(lane));
    return write('knob_' + (lane + 1) + '_set', targetParam);
}

/** Whether a lane's target is a mix param, from its `target:param` string. */
export function isMixTarget(targetParam: string): boolean {
    return targetParam.startsWith(MIX_TARGET + ':');
}
