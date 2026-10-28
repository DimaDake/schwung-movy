/* Who else may take a loop length set in Loop Mode: a New Clip preview
 * remakes its options at it instead of the clip being resized under them
 * (plans/2026-10-28-new-clip-design.md). A registry, so loop-mode.ts needs
 * no import of the generators. */

let hook: ((lenSteps: number) => boolean) | null = null;

export function setLoopLengthHook(f: ((lenSteps: number) => boolean) | null): void { hook = f; }

/** true when the length was taken (the clip is then written from bar 1). */
export function loopLengthTaken(lenSteps: number): boolean { return hook ? hook(lenSteps) : false; }
