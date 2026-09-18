/* schwung-ctx.ts — the drawing surface movy hands to Schwung's page code.
 *
 * ONE DEFINITION, because there were four. Every call site that draws through
 * Schwung's renderers built the same three-method literal, and the library only
 * ever calls `fillRect`, `print` and `textWidth` — the day one of the four grew
 * a method the other three did not is the day two screens would render
 * differently from the same input.
 *
 * THE COLOUR IS COERCED HERE, not by the callers. Schwung's renderers pass `1`
 * and `0` in most places and `true`/`false` in others — a boolean is what the
 * frame-context contract upstream documents — while `fill_rect` reads its
 * colour as a NUMBER. `true == 1` in JS, so it happens to work, which is worse
 * than not working: the coercion is invisible until someone passes something
 * that is neither.
 */
import { fontPrint, fontWidth } from '../font/index.js';

export interface DrawCtx {
    fillRect(x: number, y: number, w: number, h: number, c: any): void;
    print(x: number, y: number, t: string, c: any): void;
    textWidth(t: string): number;
}

export function movyCtx(): DrawCtx {
    return {
        fillRect: (x: number, y: number, w: number, h: number, c: any) =>
            fill_rect(x, y, w, h, c ? 1 : 0),
        print: (x: number, y: number, t: string, c: any) => fontPrint(x, y, t, c ? 1 : 0),
        textWidth: (t: string) => fontWidth(t),
    };
}
