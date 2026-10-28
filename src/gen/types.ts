/* The algorithmic generators' shared shapes (plans/2026-10-27-algorithmic-
 * generators-design.md). Notes are the engine's: ticks of 1/24 step, 16 steps
 * to the bar, pitches as stored. */

import type { AiNote, AiClip } from '../ai/clip-dump.js';
import type { AiTrackInput } from '../ai/context.js';
import type { GenLevel } from '../ai/ladders.js';
import type { Role, RoleKind } from '../ai/role.js';

export type Note = AiNote;
export type { AiClip, AiTrackInput, GenLevel, Role, RoleKind };

export const TPS = 24;              // ticks per step
export const SPB = 16;              // steps per bar
export const BAR = TPS * SPB;
export const BEAT = TPS * 4;
export const HALF = BAR / 2;        // harmony is read per half-bar (design §10)

/* double: Smart Double, the clip at twice its length with new seams. */
export type Task = 'quantize' | 'variation' | 'double';

export type Quality = 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | '5' | 'maj7' | '7' | 'm7' | 'm7b5';

/** pcs[0] is the root; the rest follow the template's order (third, fifth, seventh). */
export interface Chord { root: number; quality: Quality; pcs: number[]; bass: number }

export interface Key { tonic: number; minor: boolean; score: number }

/** Design §2: who owns the harmony of the target scene. */
export type Freedom = 'locked' | 'partial' | 'free';

/** One onset of a melodic part: the notes struck together, each keeping its
 *  own small offset, length and velocity so the player's feel survives. */
export interface Voice { pitch: number; dt: number; gate: number; vel: number }
export interface Ev { tick: number; voices: Voice[] }

/** How a part sits on chords it may not change (HARMONY when locked). */
export type Sit = 'asis' | 'roots' | 'inv' | '7th' | '9th';

/** The target harmony of one request at one HARMONY position. */
export interface HarmonyPlan {
    chords: (Chord | null)[];       // per half-bar of the TARGET clip, in clip ticks
    sit: Sit;
    pedal: number | null;           // a pitch class held under the progression
    label: string;
}

export type PresetClass = 'close' | 'rhythm' | 'exp';

/** What the request was given: the Set as the job reads it. */
export interface GenInput {
    task: Task;
    level: GenLevel;
    tracks: AiTrackInput[];
    target: { track: number; slot: number };
    source: { track: number; slot: number } | null;
    len: number;                    // target clip length, steps
    scale: [number, number];        // target playback speed (num/den)
    drum: boolean;
    kit: number[];                  // pads a drum option may use
    root?: string;                  // the Set's key setting: a hint, never a rule
    mode?: string;
}
