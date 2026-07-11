/* Slot-LFO target read/write helpers. Blocking writes for the multi-field
 * target commit — the overtake param SHM is a single slot, so consecutive
 * non-blocking writes clobber each other and the target never persists. */

function lfoKey(lfoIdx: number, key: string): string { return 'lfo' + (lfoIdx + 1) + ':' + key; }

function setBlocking(track: number, key: string, val: string): void {
    if (typeof shadow_set_param_timeout === 'function') shadow_set_param_timeout(track, key, val, 100);
    else shadow_set_param(track, key, val);
}

export function lfoTargetsParam(track: number, lfoIdx: number, comp: string, param: string): boolean {
    return !!comp
        && shadow_get_param(track, lfoKey(lfoIdx, 'target')) === comp
        && shadow_get_param(track, lfoKey(lfoIdx, 'target_param')) === param;
}

export function assignLfoTarget(track: number, lfoIdx: number, comp: string, param: string): void {
    setBlocking(track, lfoKey(lfoIdx, 'target'), comp);
    setBlocking(track, lfoKey(lfoIdx, 'target_param'), param);
    setBlocking(track, lfoKey(lfoIdx, 'enabled'), '1');
}

export function clearLfoTarget(track: number, lfoIdx: number): void {
    setBlocking(track, lfoKey(lfoIdx, 'target'), '');
    setBlocking(track, lfoKey(lfoIdx, 'target_param'), '');
    setBlocking(track, lfoKey(lfoIdx, 'enabled'), '0');
}
