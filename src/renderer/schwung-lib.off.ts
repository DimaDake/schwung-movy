/* Stand-in for schwung-lib.ts in a build made with MOVY_NO_SCHWUNG_GRID=1.
 *
 * Surface-identical and importing nothing, so the whole Schwung layer leaves
 * the module graph with it — that is the only thing this file is for. The real
 * module reaches param_pages dynamically and already survives the library being
 * absent at RUNTIME; this is about the library being absent from the BUILD,
 * which is a different question a shipping build may want to answer.
 *
 * `schwungLibAvailable()` is false here, and `schwungGridMode()` reads it before
 * anything else, so the setting pins itself to MOVY and no caller ever reaches
 * the throw below.
 */

export interface SchwungLib { [k: string]: any }

export function schwungLibAvailable(): boolean { return false; }

export function schwungLibError(): string {
    return 'built without the Schwung param_pages layer';
}

export function schwungLib(): SchwungLib {
    throw new Error('schwung param_pages was compiled out of this build');
}
