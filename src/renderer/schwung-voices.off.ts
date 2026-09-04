/* The stand-in for schwung-voices.ts in a build with the grid switched off.
 * See schwung-body.off.ts for why the module has to leave the graph.
 *
 * "Has not said" is the honest answer with no grid, and it is also the answer
 * every undeclared module gets — so callers already handle it and movy falls
 * back to its own config table exactly as it always did. Nothing throws.
 */
export interface Voice { index: number; level: string; childIndex: number | null;
                         name: string; note: number; role: string | null }
export interface VoiceSurface { layout: string | null; voices: Voice[]; focusParam: string | null }

const EMPTY: VoiceSurface = { layout: null, voices: [], focusParam: null };

export function surfaceOf(_hierarchy: any): VoiceSurface { return EMPTY; }
export function isDrumRack(_s: VoiceSurface): boolean { return false; }
export function padCount(_s: VoiceSurface): number { return 0; }
export function noteForPad(_s: VoiceSurface, _i: number): number | null { return null; }
export function padForNote(_s: VoiceSurface, _n: number): number | null { return null; }
export function labelForPad(_s: VoiceSurface, _i: number): string | null { return null; }
