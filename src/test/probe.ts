/* Movy's answer to the device test harness: a ViewModel dump.
 *
 * Compiled into the SHIPPING bundle on purpose. A test-only build is a
 * different artifact from the one users run, so tests would be passing on a
 * binary nobody ships. This is pull-only — nothing here runs unless a test
 * asks — so it costs nothing to carry.
 *
 * The bash suites read this same information by grepping a log line movy
 * flattens its view model into (`auto render held=1 | DCAY:a1t1=69% ...`) and
 * parsing it back out with grep -oE plus an awk timestamp-dedup hack. This is
 * that information without the round trip through text.
 */
import type { ViewModel } from '../types/viewmodel.js';

let lastVm: ViewModel | null = null;
let renderSeq = 0;
let tickSeq   = 0;

/* Called from the render path. renderSeq is what the harness's `settled()`
 * waits on: a sleep after a gesture asserts nothing, whereas waiting for this
 * to advance proves movy processed the input AND repainted. */
export function noteRender(vm: ViewModel): void { lastVm = vm; renderSeq++; }

export function _resetForTest(): void { lastVm = null; renderSeq = 0; tickSeq = 0; }

type Req = { id?: number; key?: string; verb?: string; arg?: unknown };

export type ProbeDeps = {
    renderer: () => string;
    lanesForTrack: (track: number) => string[];
    activeTrack: () => number;
    parked: () => boolean;
    setGridMode: (m: string | null) => void;
    /* The Leave modal's state. The harness drives a real close through this:
     * Back is not a close button (at root it OPENS this modal, while it is up
     * it dismisses it), so a fixed number of Backs is ambiguous by parity and
     * cannot close movy reliably. Reading the modal makes it closed-loop. */
    leaveModal: () => { active: boolean; label: string; sel: number };
    /* Movy's SESSION readiness — the set restored and the UI live. The host's
     * overtake gates say the DSP is up, which is a different and earlier thing:
     * a gesture sent between the two lands on whatever movy was showing before
     * the restore finished. */
    ready: () => boolean;
    /* WHICH SCREEN IS UP. Neither the renderer nor the page can answer this: a
     * screen that is not a module's knobs has no page to read, so a scenario
     * watching a gesture that LEAVES the knobs for another one — the file
     * browser a dive opens is the case that exists today — could not tell "the
     * gesture did nothing" from "the gesture worked and the screen changed".
     * Named rather than numbered, so a scenario says `file-browse` and a
     * renumbering of the constants cannot move what it asserts. */
    view: () => string;
    /* WHAT THE BROWSER IS SHOWING, when one is up. The rows are the only thing
     * that says whether a click COMMITS a file or merely walks the tree, and
     * off the device the walk is a property of a user's library rather than of
     * movy — so a scenario that clicks blind cannot tell "the commit wrote the
     * wrong key" from "no file was ever under the cursor". Only the selection
     * and the names: the paths are what a scenario grades a commit against. */
    browse: () => { dir: string; sel: number;
                    items: { name: string; path: string; isDir: boolean }[] } | null;
    /* A MODULE-SUPPLIED WIDGET, asked of the registry through MOVY'S OWN
     * BINDING rather than the library's (see renderer/schwung-widgets.ts: the
     * registry is module state, and a second import specifier is a second empty
     * map that registers nothing movy draws). `available` is the library's own
     * answer to "would this kind draw at all", which is the half a log line
     * cannot make: a registration that reached the wrong copy logs identically.
     *
     * `clearWidgets` is a MUTATION SEAM, the same kind of thing `setGridMode`
     * is: it survives no reload and writes nothing, so a scenario can put the
     * registry back to the state a module with no widget leaves it in — without
     * a module swap — and then look at the screen. That is the only way to see
     * the FALL-THROUGH draw: an unclaimed custom kind leaves its key to the
     * built-in, and a cell that goes blank instead is a regression. */
    widgetAvailable: (kind: string) => boolean;
    widgetClear: () => void;
    /* WHOSE BODY WAS DRAWN, and whether movy's ever drew over a live Schwung
     * page (SP-58). Session mode is not a `view` — it keeps whatever view it
     * was entered from — so the master chain is answered here too. */
    paramBody?: () => { body: string; trips: number; last: string;
                       session: boolean; masterDetail: boolean; masterSlot: number };
};

let deps: ProbeDeps | null = null;
export function setProbeDeps(d: ProbeDeps): void { deps = d; }

function cellOf(pv: ViewModel['rows'][number][number]) {
    if (!pv) return null;
    return {
        name:      pv.shortName,
        value:     pv.displayValue,
        automated: !!pv.automated,
        touched:   !!pv.touched,
        modulated: !!pv.modulated,
        style:     pv.renderStyle,
    };
}

function runVerb(verb: string, arg: unknown): object {
    if (!deps) return { error: 'probe deps not installed' };
    switch (verb) {
        /* An override, not the flag: it writes nothing and survives no reload,
         * so a scenario can pin a renderer without touching prefs.json. */
        case 'setGridMode':
            deps.setGridMode(arg === null ? null : String(arg));
            return { ok: true, renderer: deps.renderer() };
        /* READ AND CLEAR IN ONE CALL, because they are one question: "is this
         * kind in the registry, and take it out if I ask". Clearing is not a
         * write to anything durable — see ProbeDeps — so it is safe on a
         * device whose prefs a scenario must not touch. */
        case 'widgets': {
            const a = (arg && typeof arg === 'object') ? (arg as any) : {};
            const kind = String(a.kind || '');
            if (a.clear) deps.widgetClear();
            return { kind, available: deps.widgetAvailable(kind) };
        }
        default:
            return { error: 'unknown verb: ' + verb };
    }
}

export function answer(requestJson: string): string {
    let req: Req;
    try { req = JSON.parse(requestJson); }
    catch (e) { return JSON.stringify({ error: 'bad request json: ' + String(e) }); }
    /* The reply carries the request's id back. Without it the harness cannot
     * tell a fresh answer from the PREVIOUS one still sitting in the engine's
     * mailbox, and every assertion would be one round behind without saying so. */
    const tag = (o: object) => JSON.stringify(req.id === undefined ? o : { id: req.id, ...o });

    if (req.verb) return tag(runVerb(req.verb, req.arg));

    switch (req.key) {
        case 'tick':
            return tag({ tickSeq, renderSeq, parked: deps ? deps.parked() : false,
                         ready: deps ? deps.ready() : false });
        case 'page': {
            const vm = lastVm;
            if (!vm) return tag({ error: 'no render yet' });
            const cells = [];
            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 4; c++) cells.push(cellOf(vm.rows[r]?.[c] ?? null));
            }
            return tag({
                pageIndex: vm.bankIndex,
                pageCount: vm.bankCount,
                renderer:  deps ? deps.renderer() : 'unknown',
                held:      !!vm.automationHeld,
                module:    vm.moduleName,
                /* Read live rather than from the VM: the VM is the last page
                 * movy RENDERED, and a screen with no page behind it — the file
                 * browser — leaves that stale by design. This is the one field
                 * here that answers about the screen instead of about the page
                 * on it. */
                view:      deps ? deps.view() : 'unknown',
                ...(deps?.paramBody ? deps.paramBody() : {}),
                cells,
            });
        }
        case 'leave': {
            if (!deps) return tag({ error: 'probe deps not installed' });
            return tag(deps.leaveModal());
        }
        case 'browse': {
            if (!deps || !deps.browse) return tag({ error: 'probe deps not installed' });
            return tag({ browse: deps.browse() });
        }
        case 'auto': {
            if (!deps) return tag({ error: 'probe deps not installed' });
            const track = deps.activeTrack();
            return tag({ track, lanes: deps.lanesForTrack(track) });
        }
        default:
            return tag({ error: 'unknown key: ' + String(req.key) });
    }
}
