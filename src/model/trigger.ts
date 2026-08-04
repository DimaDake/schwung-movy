import { setChainParamUntracked } from '../chain/set-param.js';
/* One-shot "trigger" knobs — params a module declares as actions rather than
 * values (behavior: "trigger", or the conventional ["idle","trigger"] enum).
 *
 * A clockwise turn fires once. The knob then latches, so the rest of that same
 * hand movement does nothing; it re-arms on a counter-clockwise turn, or once
 * TRIGGER_REARM_MS passes with no turn at all. That timer is a gesture-end
 * debounce rather than a cooldown — every turn restarts it, so one sweep fires
 * once and a deliberate second gesture fires again.
 *
 * The displayed value stays at `idle` forever, so the badge (not the param
 * value) is what tells the user anything happened. That means state here is
 * never derived from a read-back: a module that latches its own param cannot
 * drag the badge out of sync.
 */
import type { KnobParam } from '../types/param.js';
import type { ModelState, TriggerState } from './state.js';
import { TRIGGER_FLASH_MS, TRIGGER_REARM_MS, TRIGGER_BLINK_MS } from './constants.js';
import { enumSetValue } from './enum-value.js';
import { mlog } from '../log.js';

/* Drain resolution. The badge repaints once per step instead of once per tick,
 * so a cooldown costs ~8 repaints rather than ~70 at device tick rates. */
export const COOL_STEPS = 8;

export interface TriggerVisual {
    phase:     'armed' | 'fired' | 'cooling';
    coolSteps: number;   // drain remaining, 0..COOL_STEPS
    blinkOn:   boolean;  // fired only: which half of the blink cycle
}

const ARMED: TriggerVisual = { phase: 'armed', coolSteps: 0, blinkOn: false };

/* A trigger's idle/trigger option indexes. Named options win; an explicit
 * behavior:"trigger" on some other 2+ option enum falls back to 0/1. */
export function triggerIndices(p: KnobParam): { idle: number; trigger: number } | null {
    if (p.behavior !== 'trigger' || !p.options || p.options.length < 2) return null;
    const normalized = p.options.map(v => String(v).trim().toLowerCase());
    const idle = normalized.indexOf('idle');
    const trigger = normalized.indexOf('trigger');
    if (idle >= 0 && trigger >= 0) return { idle, trigger };
    return { idle: 0, trigger: 1 };
}

function stateFor(s: ModelState, key: string): TriggerState {
    return s.triggerStates[key] ??= {
        latched: false, autoRearm: true, lastTurnMs: 0, firedAtMs: 0,
        paintedPhase: 'armed', paintedCool: 0, paintedBlink: false,
    };
}

/* A latch we caused releases once the hand has been still for the debounce. One
 * we merely inferred at load has no timer running, so it waits for a CCW turn. */
function latchReleased(t: TriggerState, now: number): boolean {
    return t.autoRearm && now - t.lastTurnMs > TRIGGER_REARM_MS;
}

export function triggerVisual(s: ModelState, key: string, now = Date.now()): TriggerVisual {
    const t = s.triggerStates?.[key];
    if (!t) return ARMED;
    const sinceFire = now - t.firedAtMs;
    if (t.firedAtMs > 0 && sinceFire < TRIGGER_FLASH_MS) {
        const blinkOn = Math.floor(sinceFire / TRIGGER_BLINK_MS) % 2 === 0;
        return { phase: 'fired', coolSteps: COOL_STEPS, blinkOn };
    }
    if (!t.latched || latchReleased(t, now)) return ARMED;
    if (!t.autoRearm) return { phase: 'cooling', coolSteps: 0, blinkOn: false };
    const remaining = TRIGGER_REARM_MS - (now - t.lastTurnMs);
    const steps = Math.ceil(remaining / TRIGGER_REARM_MS * COOL_STEPS);
    return { phase: 'cooling', coolSteps: Math.max(0, Math.min(COOL_STEPS, steps)), blinkOn: false };
}

/* Advance the badge animation: true only when a badge's APPEARANCE changed since
 * the last paint, so the frame is dirtied once per visible step rather than once
 * per tick. The drain is quantised to COOL_STEPS, so a whole cooldown costs a
 * handful of repaints and then goes quiet. */
export function triggerAnimationTick(s: ModelState, now = Date.now()): boolean {
    let changed = false;
    for (const key of Object.keys(s.triggerStates)) {
        const t = s.triggerStates[key];
        const v = triggerVisual(s, key, now);
        if (v.phase !== t.paintedPhase || v.coolSteps !== t.paintedCool
            || v.blinkOn !== t.paintedBlink) {
            t.paintedPhase = v.phase;
            t.paintedCool  = v.coolSteps;
            t.paintedBlink = v.blinkOn;
            changed = true;
        }
    }
    return changed;
}

/* Seed the badge from the value the DSP already holds. A param sitting at
 * `trigger` means a CW turn would write a value it already has — no edge, no
 * action — so show it latched and let the user turn back. movy deliberately does
 * NOT write `idle` to normalise it: smack's `arm` is "arm-and-record" and holds
 * real module state, and we cannot tell stale from meaningful. */
export function seedTriggerState(s: ModelState, p: KnobParam, rawIndex: number | null): void {
    if (s.triggerStates[p.key]) return;   // only ever seeds a fresh state
    const idx = triggerIndices(p);
    if (!idx || rawIndex === null) return;
    if (rawIndex !== idx.trigger) return;
    const t = stateFor(s, p.key);
    t.latched   = true;
    t.autoRearm = false;
    t.firedAtMs = 0;
}

/* Consume a knob delta for a trigger param. Returns false when p is not a
 * trigger, so the caller falls through to the ordinary param path.
 * `enumFmt` is a thunk: resolving the format can probe the DSP, so it must only
 * run when a write actually happens. */
export function applyTriggerDelta(
    s: ModelState, gi: number, p: KnobParam, ioKey: string,
    delta: number, enumFmt: () => boolean,
): boolean {
    const idx = triggerIndices(p);
    if (!idx || delta === 0) return false;

    const now = Date.now();
    const t = stateFor(s, p.key);
    if (latchReleased(t, now)) t.latched = false;
    t.lastTurnMs = now;                 // every turn restarts the debounce
    s.knobValues[gi] = idx.idle;        // the badge owns the display

    let sendIndex: number | null = null;
    if (delta < 0) {
        /* CCW re-arms a latched trigger. When already armed the param is
         * necessarily idle, so writing it again is pure IPC noise. */
        if (t.latched) {
            t.latched   = false;
            t.autoRearm = true;
            t.firedAtMs = 0;
            sendIndex   = idx.idle;
        }
    } else if (!t.latched) {
        t.latched   = true;
        t.autoRearm = true;
        t.firedAtMs = now;
        sendIndex   = idx.trigger;
    }

    if (sendIndex !== null) {
        const value = enumSetValue(p.options, sendIndex, enumFmt());
        mlog('trigger slot=' + s.activeSlot + ' key=' + s.componentKey + ':' + ioKey + ' val=' + value);
        /* A trigger fires an action rather than holding a value, so there is no
         * previous value to return to — recorded as untracked instead of
         * inventing an inverse that would not undo anything. */
        setChainParamUntracked(s.activeSlot, s.componentKey + ':' + ioKey, value);
    }
    s.dirty = true;
    return true;
}
