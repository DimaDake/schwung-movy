/* schwung-virtual-canvas.ts — custom (canvas) pages for a virtual component.
 *
 * Wraps a `createVirtualSource` table so its knobs are split across levels,
 * each led by a `type: "canvas", as_page: true, page_first: true` param —
 * Schwung's custom page: the host keeps the header, bank bar, held-knob toast,
 * jog and knob mapping, and the source draws only the body. Kept beside
 * `schwung-virtual-source.ts` rather than inside it: that file is the flat
 * one-level table every other virtual page uses, and is at its size cap.
 *
 * The planner always emits a level's knob grid as well (measured against the
 * pinned planner: canvas, grid, canvas, grid). `canvasOnly` asks movy's jog
 * order to skip those; a planner flag that never plans them is the upstream
 * fix (plans/2026-10-18-session-mixer.md). */

import type { PageParamSource } from './schwung-page-source.js';

export interface VirtualCanvasPage {
    /** The canvas param's key — never a knob, and answers "". */
    canvasKey: string;
    /** The page name: the header's right side and the planner's page label. */
    name: string;
    knobs: readonly string[];
}

const HIER_KEY = 'ui_hierarchy';
const PARAMS_KEY = 'chain_params';

export function withCanvasPages(base: PageParamSource, componentKey: string,
                                pages: readonly VirtualCanvasPage[],
                                draw: NonNullable<PageParamSource['drawCanvasPage']>): PageParamSource {
    const prefix = componentKey + ':';
    const bare = (k: string): string => (k.startsWith(prefix) ? k.slice(prefix.length) : k);
    const canvasKeys = new Set(pages.map((p) => p.canvasKey));

    /* Levels in page order: `root` first, because the planner walks the levels
     * object in insertion order and names a walk root's page itself. */
    function hierarchyJson(): string {
        const levels: Record<string, unknown> = {};
        pages.forEach((p, i) => {
            levels[i === 0 ? 'root' : p.canvasKey] = { knobs: [...p.knobs], params: [p.canvasKey] };
        });
        return JSON.stringify({ levels });
    }

    function chainParamsJson(): string | null {
        const raw = base.getParam(PARAMS_KEY);
        if (raw === null) return null;
        const cells = JSON.parse(raw) as unknown[];
        for (const p of pages) {
            cells.push({ key: p.canvasKey, name: p.name, type: 'canvas', as_page: true, page_first: true });
        }
        return JSON.stringify(cells);
    }

    return {
        ...base,
        getParam(k: string): string | null {
            const b = bare(k);
            if (b === HIER_KEY) return hierarchyJson();
            if (b === PARAMS_KEY) return chainParamsJson();
            if (canvasKeys.has(b)) return '';
            return base.getParam(k);
        },
        drawCanvasPage: draw,
        canvasOnly: true,
    };
}
