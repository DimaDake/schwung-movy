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

type Req = { key?: string; verb?: string; arg?: unknown };

export type ProbeDeps = {
    renderer: () => string;
    lanesForTrack: (track: number) => string[];
    activeTrack: () => number;
    parked: () => boolean;
    setGridMode: (m: string | null) => void;
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

    if (req.verb) return JSON.stringify(runVerb(req.verb, req.arg));

    switch (req.key) {
        case 'tick':
            return JSON.stringify({
                tickSeq, renderSeq,
                parked: deps ? deps.parked() : false,
            });
        case 'page': {
            const vm = lastVm;
            if (!vm) return JSON.stringify({ error: 'no render yet' });
            const cells = [];
            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 4; c++) cells.push(cellOf(vm.rows[r]?.[c] ?? null));
            }
            return JSON.stringify({
                pageIndex: vm.bankIndex,
                pageCount: vm.bankCount,
                renderer:  deps ? deps.renderer() : 'unknown',
                held:      !!vm.automationHeld,
                module:    vm.moduleName,
                cells,
            });
        }
        case 'auto': {
            if (!deps) return JSON.stringify({ error: 'probe deps not installed' });
            const track = deps.activeTrack();
            return JSON.stringify({ track, lanes: deps.lanesForTrack(track) });
        }
        default:
            return JSON.stringify({ error: 'unknown key: ' + String(req.key) });
    }
}
