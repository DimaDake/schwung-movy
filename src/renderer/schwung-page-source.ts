/* schwung-page-source.ts — what `createSchwungPage`'s pipeline actually needs
 * from wherever a component's params live.
 *
 * Loosened from `TrackPort`: a real module's port has a `track` (a claim about
 * WHICH track) and a `sendMidi` (a claim this whole pipeline never calls — see
 * the grep in page-owner.mjs's sibling suites). A virtual component (SP-53)
 * makes neither claim, and `TrackPort` means something specific — "how you
 * talk to a track" — so widening IT to also cover "movy's own state, no track
 * involved" would blur the one thing that file is for.
 *
 * `TrackPort` already satisfies this shape structurally: nothing that already
 * passes a port to `createSchwungPage` changes. This interface exists so a
 * SECOND kind of thing can be passed too, without either faking the fields it
 * does not have (the way `EngineRootPort` fakes `track: {index: 0}` "as a
 * claim it does not make") or widening `TrackPort` to cover a claim-free case.
 */

export interface PageParamSource {
    /** True when a single read costs a full round trip — see `TrackPort`.
     *  A virtual source's read is a field access: always false, which is what
     *  turns `createPageReadCache` into a passthrough for it (no bulk fill, no
     *  epoch — see its own guard). */
    readonly bulkReads: boolean;

    getParam(key: string): string | null;
    setParam(key: string, value: string): boolean;

    /** Optional bulk/write-log members `createPageReadCache`/`schwung-page-batch`
     *  already treat as optional on `TrackPort`. A virtual source declares
     *  none of them (bulkReads is false, so they are never asked for). */
    getMany?(keys: string[]): (string | null)[];
    setMany?(pairs: [string, string][]): boolean;
    writeSeq?(): number;
    writesSince?(seq: number): string[] | null;

    /** `createController(io)`'s `vizOverrides` hook (*The injection surface*
     *  §1) — force an unclaimed key into a `custom:` kind. Belongs to the
     *  SOURCE, not to the plumbing threading it through: a real port has none
     *  today (unchanged), a virtual one can supply it without a new
     *  constructor argument on every file between here and `createController`. */
    vizOverrides?(key: string): unknown;

    /** `createController(io)`'s `formatValue` hook (*The injection surface*
     *  §4) — a reading only the source can compute (SP-53's "n/a on a drum
     *  track", the tempo knob's "120 EXT"). `surface` is 'cell' or 'header';
     *  null falls through to Schwung's own formatting, per key. */
    formatValue?(fullKey: string, raw: string | null, surface: 'cell' | 'header'): string | null;

    /** How many raw CC units make ONE `ctl.onKnobTurn` call for this key.
     *
     *  movy expands an encoder's accumulated magnitude into that many detents
     *  (`schwung-page-input.ts`) — the fix for "knobs move very very slowly
     *  like shift is held", and right for a module page, whose step comes from
     *  the module's own contract.
     *
     *  On movy's OWN pages it is not: those charged 8 raw units per step before
     *  delegation (`seq/detent.ts`'s `DETENT_DIV`, and every `*PageKnob`
     *  writer), and one-detent-per-unit into `ENUM_DELTA_DIV = 4` makes every
     *  enum twice as fast as it was. So the source that owns those cells says
     *  what a detent costs.
     *
     *  Absent or null means 1 — today's behaviour, and what every real port
     *  answers. That is what keeps module pages out of this by construction
     *  rather than by a flag. */
    rawPerDetent?(fullKey: string): number | null;
}
