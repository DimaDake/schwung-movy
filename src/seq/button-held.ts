/* Which button CCs are physically down.
 *
 * Move's own convention is that a button lit dim (meaning "you can press this")
 * goes full bright while it is actually held. Movy only did that for the bar
 * arrows, which made every other button feel dead under the finger. Tracking the
 * press here lets led-cache.ts apply the rule to every button at once, rather
 * than threading a `pressed` flag through each colour function.
 *
 * Relative encoders are excluded by the caller: they send values, not button
 * states, and d2 === 0 from an encoder means "no movement", not "up". */

const held = new Set<number>();

export function setButtonHeld(cc: number, down: boolean): void {
    if (down) held.add(cc);
    else held.delete(cc);
}

export function buttonHeld(cc: number): boolean {
    return held.has(cc);
}

/** Nothing is held after a teardown or an input reset — a press whose release
 *  never arrived would otherwise leave its LED stuck bright. */
export function resetButtonHeld(): void {
    held.clear();
}
