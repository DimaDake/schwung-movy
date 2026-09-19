/* What a delegated page may ask about movy's automation lanes (SP-36).
 *
 * The shape lives in `types/` because both ends of the seam need it and
 * neither may import the other: the implementation is app state
 * (`app/automated-keys.ts`, which reads the lane registry) and the consumer is
 * a renderer (`renderer/schwung-page-io.ts`, which may not grow app state).
 * Keys are COMPONENT-QUALIFIED and concrete — `synth:cutoff` — the same form a
 * lane's `targetParam` is written in.
 */
export interface PageAutomation {
    /** Is a lane driving this key right now? */
    isAutomated(fullKey: string): boolean;
    /** The value the user dialled in, or null when movy has never held one. */
    baseOf(fullKey: string): number | null;
    /** A turn under the page IS an edit of the base — keep the record exact. */
    noteBase(fullKey: string, value: number): void;
}
