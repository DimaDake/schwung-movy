/* What a Variation request knows beyond the context text
 * (plans/2026-10-27-variation-eight-options.md): the source's role, whether
 * the target scene's chords are already set by other tracks, and the track's
 * clips an option must not repeat. One reader for the job and the bench. */

import type { AiNote } from './clip-dump.js';
import type { AiContextInput } from './context.js';
import { type Role, roleOf } from './role.js';

export interface VariationFacts {
    role: Role | null;
    harmonySet: boolean;
    source: AiNote[];
    loops: AiNote[][];
}

export function variationFacts(s: AiContextInput, lenSteps: number): VariationFacts {
    const t = s.tracks.find((x) => x.index === s.target.track);
    const src = s.source ? t?.clips.find((c) => c.slot === s.source!.slot)?.notes ?? [] : [];
    return {
        role: roleOf(src, lenSteps, t?.drum ?? false),
        harmonySet: s.tracks.some((x) => x.index !== s.target.track && !x.drum
            && x.clips.some((c) => c.slot === s.target.slot && c.notes.length > 0)),
        source: src,
        loops: (t?.clips ?? []).filter((c) => c.slot !== s.target.slot && c.notes.length > 0).map((c) => c.notes),
    };
}
