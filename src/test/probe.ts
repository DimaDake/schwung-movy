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
export function noteTick(): void { tickSeq++; }

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
                cells,
            });
        }
        case 'leave': {
            if (!deps) return tag({ error: 'probe deps not installed' });
            return tag(deps.leaveModal());
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
