/* schwung-widgets.ts — module-supplied widgets, registered by movy.
 *
 * A module can ship a `canvas.js` beside its module.json that draws its own
 * cell (Schwung #405). The library handles everything EXCEPT the registration:
 * `viz.mjs` claims a cell for a `custom:` kind only once `registerWidget` has
 * been told how to draw it, and the controller's own `vizGroups()` then carries
 * it into the render movy already asks for. So movy needs this one step and
 * gets the rest for free.
 *
 * NOT REGISTERING IS SAFE. An unclaimed custom kind leaves its keys in the
 * detector pool and a built-in widget draws instead — the registry's single
 * fall-through path, which also covers author typos, a canvas.js that failed to
 * load, and an older host reading a newer module. A missing widget is a
 * different picture, never a hole. Every "that did not work out" branch below
 * therefore ends in the same place: hand the registry nothing and let the
 * built-in draw.
 *
 * THE FILE SIDE LIVES NEXT DOOR (schwung-canvas.ts): which script a module
 * ships, and what it published. It is separate because it must stay drivable
 * with no Schwung checkout, while everything in THIS file is the door to the
 * registry. What a module DECLARES is decided here, on the near side of that
 * door, because it is the part that fails quietly: a shape movy does not
 * understand registers nothing and the built-in draws, which looks like a
 * perfectly reasonable page and is not the module author's.
 */
import { schwungLib } from './schwung-lib.js';
import { findOverlay } from './schwung-canvas.js';
import { mlog } from '../log.js';

/*
 * RE-EXPORTED BECAUSE THE REGISTRY IS PER MODULE INSTANCE.
 *
 * `registered` is module state. A caller that imports widget_registry.mjs by a
 * DIFFERENT specifier — from a schwung checkout directly, rather than through
 * the device path this file uses — gets a second instance with its own empty
 * map, registers into it, and sees nothing drawn. It cost an afternoon once:
 * the widget was registered, `isWidgetAvailable` said yes, and `vizGroups()`
 * still came back empty, because the controller was asking the other copy.
 *
 * So movy's binding is the one door. Anything registering a widget for movy —
 * including its tests — goes through here.
 *
 * AND AN ABSENT LIBRARY IS THE SAME ANSWER AS AN UNREGISTERED KIND. A Schwung
 * without param_pages, or a local build with no checkout, leaves `schwungLib()`
 * throwing; on the page path that is one more way to have no widget, which the
 * fall-through already draws correctly. Letting it throw would turn this file's
 * safety story into a crash instead.
 */
export function registerWidget(kind: string, impl: any): void {
    try { schwungLib().registerWidget(kind, impl); } catch (_e) { /* nothing claims the cell */ }
}
function libClear(): void {
    try { schwungLib().clearWidgets(); } catch (_e) { /* nothing to clear */ }
}
export function clearWidgets(): void { owned.clear(); libClear(); }
export function isWidgetAvailable(kind: string): boolean {
    try { return !!schwungLib().isWidgetAvailable(kind); } catch (_e) { return false; }
}

/*
 * WHAT MOVY HAS PUT IN THE REGISTRY, AND WHICH PAGE PUT IT THERE.
 *
 * THE REGISTRY'S ONLY REMOVAL EMPTIES ALL OF IT. `clearWidgets()` is the whole
 * of the library's unregister — there is no per-kind one — so the clear that
 * stops a DEPARTED module's art from being inherited also took the art of the
 * component next door, which had done nothing but exist. And it never came
 * back: the sync latches on a settled answer, so the page that registered it is
 * not asked again until its own plan moves. Walking one chain slot along and
 * back lost hank's waveform for the rest of the session.
 *
 * So movy keeps its own copy of what it registered, and the library's map is a
 * PROJECTION of this one: every change empties the library and replays the
 * whole map into it. Replaying is cheap — the drawers are already in memory,
 * and nothing here re-reads a file or re-evaluates a script.
 *
 * THE OWNER IS THE PAGE, NOT THE MODULE. It is the `(track, component)` the
 * page cache is keyed by, so a module swapped INTO a slot still replaces
 * exactly what the module before it left THERE — the property the clear existed
 * for, and the one a scoping fix is most likely to drop.
 *
 * A KIND TWO OWNERS BOTH CLAIM goes to the later one, which is what a map keyed
 * by kind meant before this existed too. Two modules publishing one `custom:`
 * name is the collision the name is supposed to prevent, and movy is not the
 * layer that can arbitrate it.
 */
interface OwnedWidget { owner: string; draw: (ctx: any) => void; nominal: any; }
const owned = new Map<string, OwnedWidget>();

function replayRegistry(): void {
    libClear();
    for (const [kind, w] of owned) registerWidget(kind, { draw: w.draw, nominal: w.nominal });
}

/** Replace everything `owner` has registered with `widgets` — an empty list
 *  being how a page says it has none. */
export function setOwnerWidgets(owner: string, widgets: OverlayWidget[]): void {
    for (const [kind, w] of owned) if (w.owner === owner) owned.delete(kind);
    for (const w of widgets) owned.set(w.kind, { owner, draw: w.draw, nominal: w.nominal });
    replayRegistry();
}

/** Does this contract declare a widget at all? Nothing is loaded if not. */
export function declaresCustomWidget(chainParams: any[]): boolean {
    if (!Array.isArray(chainParams)) return false;
    return chainParams.some((p) => {
        const k = p && p.viz && p.viz.kind;
        return typeof k === 'string' && k.startsWith('custom:');
    });
}

/** One drawer, as it will be handed to the registry. */
export interface OverlayWidget { kind: string; draw: (ctx: any) => void; nominal: any; }

/**
 * Every widget one canvas overlay publishes.
 *
 * THE SHAPES ARE UPSTREAM'S (`registerOverlayWidgets`, widget_registry.mjs),
 * MIRRORED RATHER THAN CALLED. Calling it through the door would put this
 * decision behind the library, where nothing without a Schwung checkout can see
 * it — and it is the decision that goes wrong invisibly. The cost of mirroring
 * is bounded, because a shape movy does not know about registers nothing and
 * the built-in draws: the fall-through either way.
 *
 *   widgetKind:  "custom:a"                  + drawCell   (one widget)
 *   widgetKinds: ["custom:a", "custom:b"]    + drawCell   (one drawer, the kind
 *                                                         says which cell)
 *   widgetKinds: { "custom:a": fn | { draw | drawCell, nominal } }
 *
 * The singular is read FIRST, so a module spelling both keeps the richer entry
 * for the name they share, and a module may use more than one shape.
 */
export function overlayWidgets(ov: any): OverlayWidget[] {
    const out: OverlayWidget[] = [];
    if (!ov || typeof ov !== 'object') return out;
    const fallback = typeof ov.drawCell === 'function' ? ov.drawCell.bind(ov) : null;
    const nominal = ov.widgetNominal || null;
    const add = (kind: any, draw: any, nom: any) => {
        if (typeof kind !== 'string' || !kind.startsWith('custom:')) return;
        if (typeof draw !== 'function') return;
        out.push({ kind, draw, nominal: nom || nominal });
    };
    if (typeof ov.widgetKind === 'string') add(ov.widgetKind, fallback, nominal);
    const many = ov.widgetKinds;
    if (Array.isArray(many)) {
        for (const k of many) add(k, fallback, nominal);
    } else if (many && typeof many === 'object') {
        for (const k of Object.keys(many)) {
            const e = many[k];
            if (typeof e === 'function') add(k, e.bind(ov), nominal);
            else if (e && typeof e === 'object') {
                const d = typeof e.draw === 'function' ? e.draw
                        : (typeof e.drawCell === 'function' ? e.drawCell : null);
                add(k, d ? d.bind(ov) : null, e.nominal || e.widgetNominal);
            }
        }
    }
    return out;
}

/**
 * Register whatever widgets the module in this component supplies, replacing
 * whatever the module before it left.
 *
 * RETURNS WHETHER THE QUESTION IS CLOSED. `true` means "this module's art is in
 * the registry, or it has none" — a state a second identical ask cannot improve
 * on. `false` means the answer has not arrived: the module is not where we
 * looked, or its script did not load. The caller keeps asking on a false and
 * must NOT latch it; latching a decision taken from a read that had not settled
 * is how the widget never appeared on Schwung's own host, twice.
 *
 * THE MODULE ID IS A READ, NOT AN ARGUMENT. It costs a blocking round trip, and
 * this runs on the page's divider — so it is asked for lazily, once the contract
 * has said it declares a `custom:` kind at all. Taking it as a value made every
 * caller pay for the common case: `grid-cost` caught the delegated page's idle
 * floor at 221 round trips over 600 ticks against a ceiling of 219, exactly one
 * trip per divider, for 600 ticks in which nothing was ever registered.
 *
 * AN EMPTY chain_params IS NOT AN ANSWER. A chain component always declares
 * something, so an empty array is a read that has not arrived — decide nothing,
 * clear nothing, latch nothing.
 *
 * THE REGISTRY IS PROCESS-GLOBAL AND shadow_ui IS LONG-LIVED. A departed
 * module's widget would outlive it, and the next module declaring the same
 * `custom:` name would silently inherit the wrong art. So the clear comes
 * BEFORE the registration, and it comes even for a module that declares nothing
 * — that being exactly the case where a stale name would otherwise be served.
 *
 * IT IS THIS OWNER'S CLEAR, NOT THE REGISTRY'S. `owner` names the page asking,
 * and only what that page put there is dropped — see `setOwnerWidgets` above
 * for why a whole-registry clear here cost every OTHER page its art.
 */
export function registerModuleWidgets(owner: string, readId: () => string,
                                      chainParams: any[]): boolean {
    if (!Array.isArray(chainParams) || chainParams.length === 0) return false;
    if (!declaresCustomWidget(chainParams)) {
        setOwnerWidgets(owner, []);         /* declares nothing: settled, and nothing is read */
        return true;
    }
    const moduleId = readId();
    if (!moduleId) return false;                                  /* no id, no verdict */
    setOwnerWidgets(owner, []);
    const ov = findOverlay(moduleId);
    if (!ov) {
        mlog(`widgets: ${moduleId} declares a custom kind but its canvas.js did not load`);
        return false;
    }
    const kinds = overlayWidgets(ov);
    setOwnerWidgets(owner, kinds);
    /* Both branches are said out loud: a module drawing a built-in dial is a
     * correct-looking page, and this line is the only thing that tells its
     * author the picture is not theirs. */
    mlog(kinds.length
        ? `widgets: ${moduleId} registered ${kinds.map((w) => w.kind).join(', ')}`
        : `widgets: ${moduleId} declares a custom kind but its canvas.js draws none`);
    return true;
}
