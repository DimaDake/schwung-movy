# Envelope UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four ADSR knobs on a parameter page with a single expressive envelope graphic on one knob line, while the four names keep their normal label cells and knob behaviour (touch → invert → value → toast, automation dot).

**Architecture:** A pure detector (`model/envelope.ts`) recognizes complete A/D/S/R sets on a page (by name or explicit `env` JSON tag) and plans a per-line layout, carrying each param's page-relative index so touch/value stay correctly mapped even when params are rearranged. `buildViewModel` consumes the layout and flags envelope lines; a pure renderer (`renderer/envelope.ts`) draws the graphic across the full line width. The four label cells render exactly as today.

**Tech Stack:** TypeScript → `ui.js` (esbuild), browser-test harness (`logic.mjs`, `screenshot.mjs`, `perf.mjs`), QuickJS device runtime.

## Global Constraints

- File size: hard limit 200 lines, target 50–100; one responsibility per file.
- `model/` never calls display functions; `renderer/` is pure (same inputs → same pixels), no state; `src/types/` imports nothing from `src/`.
- No code duplication — extract shared draw primitives rather than copy.
- New rendering logic → screenshot test; new business logic → logic test.
- Comments explain WHY, never WHAT.
- Dev loop (run from `movy/`): `npm run build:browser` then `node browser-test/logic.mjs`, `app-loop.mjs`, `screenshot.mjs`, `perf.mjs` (or `npm test`). Regenerate baselines when UI changes: `node browser-test/screenshot.mjs --update`.
- Device tests when `move.local` reachable; if offline report **DEVICE OFFLINE** in CAPS.
- Detection rule: an envelope forms **only if all four roles A,D,S,R are present** in a group. Bare single-letter roles (`a/d/s/r`) match **only when all four bare letters co-occur** on the page.
- Vertex directions (fixed): Attack → peak moves right; Decay → sustain-start moves right; Sustain → plateau moves up; Release → end moves right. Dotted verticals only at the two plateau corners.

---

### Task 1: Detection + layout planning (pure) + types + JSON wiring

**Files:**
- Modify: `src/types/param.ts` (add `env?` to `KnobSlot` and `KnobParam`)
- Modify: `src/types/viewmodel.ts` (add `EnvelopeVM`, `ViewModel.envelopeLines?`)
- Create: `src/model/envelope.ts`
- Modify: `src/model/hierarchy.ts:122-131` (wire `slot.env` → `param.env`)
- Test: `browser-test/logic.mjs` (append a "── Envelope detection ──" block)

**Interfaces:**
- Produces:
  - `type EnvRole = 'a' | 'd' | 's' | 'r'`
  - `detectEnvelopes(params: (KnobParam | null)[]): EnvGroup[]` where `interface EnvGroup { a: number; d: number; s: number; r: number; name: string }` (numbers are indices into `params`, 0-based; sorted by smallest member index).
  - `interface PageCell { line: 0 | 1; col: 0 | 1 | 2 | 3; idx: number }` (`idx` = page-relative param index 0..7).
  - `interface PageLayout { cells: PageCell[]; envelopes: { line: 0 | 1; name: string }[] }`
  - `planPageLayout(params: (KnobParam | null)[]): PageLayout`
  - `interface EnvelopeVM { name: string }`; `ViewModel.envelopeLines?: (EnvelopeVM | null)[]` (length 2).

- [ ] **Step 1: Add the type fields**

In `src/types/param.ts`, add to `KnobSlot` (after `render?`):
```ts
    env?:           'a' | 'd' | 's' | 'r';
```
and to `KnobParam` (after `renderStyle`):
```ts
    env?:           'a' | 'd' | 's' | 'r';
```

In `src/types/viewmodel.ts`, add before `ViewModel`:
```ts
export interface EnvelopeVM {
    name: string;   // qualifier label ("Filter"/"Amp"/""); not rendered, kept for tests/future
}
```
and add to `ViewModel` (after `rows`):
```ts
    /* When a knob line is an ADSR envelope, envelopeLines[line] is set and that
     * line's rows[line][0..3] hold the A,D,S,R ParamVMs in column order. */
    envelopeLines?:  (EnvelopeVM | null)[];
```

- [ ] **Step 2: Write the failing detection test**

Append to `browser-test/logic.mjs` (before the final summary print). Add the import near the top imports:
```js
import { detectEnvelopes, planPageLayout } from '../dist/esm/model/envelope.js';
```
Then the test block:
```js
_log('\n── Envelope detection ──');
const P = (key, label, env) => ({ key, label, shortLabel: null, type: 'float',
    min: 0, max: 1, step: 0.01, options: null, renderStyle: 'arc', automatable: true, env });

// Full-word amp ADSR + 4 other params (Moog/OB-Xd main shape)
{
    const page = [
        P('cutoff','Cutoff'), P('resonance','Resonance'), P('contour','Contour'), P('glide','Glide'),
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
    ];
    const g = detectEnvelopes(page);
    eq('amp ADSR: one group', g.length, 1);
    eq('amp ADSR: a index', g[0]?.a, 4);
    eq('amp ADSR: r index', g[0]?.r, 7);
}
// Two qualified groups: amp (plain) + filter (f_ prefix)
{
    const page = [
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
        P('f_attack','F Attack'), P('f_decay','F Decay'), P('f_sustain','F Sustain'), P('f_release','F Release'),
    ];
    const g = detectEnvelopes(page);
    eq('dual env: two groups', g.length, 2);
    eq('dual env: amp first (idx0)', g[0]?.a, 0);
    eq('dual env: filter second (idx4)', g[1]?.a, 4);
}
// Partial set (attack+decay only) → no envelope
{
    const page = [ P('attack','Attack'), P('decay','Decay'), P('cutoff','Cut'), P('reso','Res') ];
    eq('partial set: no group', detectEnvelopes(page).length, 0);
}
// Abbreviations
{
    const page = [ P('atk','Atk'), P('dcy','Dcy'), P('sus','Sus'), P('rel','Rel') ];
    eq('abbrev set: one group', detectEnvelopes(page).length, 1);
}
// Bare single letters — all four present → group
{
    const page = [ P('a','A'), P('d','D'), P('s','S'), P('r','R') ];
    eq('bare letters all four: group', detectEnvelopes(page).length, 1);
}
// Bare single letters — only three present → no group (guard)
{
    const page = [ P('a','A'), P('d','D'), P('s','S'), P('cutoff','Cut') ];
    eq('bare letters partial: no group', detectEnvelopes(page).length, 0);
}
// Explicit env tag overrides naming
{
    const page = [ P('h1','Harm',undefined), P('p2','Punch'),
        P('e_a','EA','a'), P('e_d','ED','d'), P('e_s','ES','s'), P('e_r','ER','r') ];
    const g = detectEnvelopes(page);
    eq('env tag: one group', g.length, 1);
    eq('env tag: a index', g[0]?.a, 2);
}
// Layout: amp ADSR on second row, others consolidated to first line
{
    const page = [
        P('cutoff','Cutoff'), P('resonance','Resonance'), P('contour','Contour'), P('glide','Glide'),
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
    ];
    const L = planPageLayout(page);
    eq('layout: env on line 1', L.envelopes[0]?.line, 1);
    const env = L.cells.filter(c => c.line === 1).map(c => c.idx);
    eq('layout: line1 = a,d,s,r order', JSON.stringify(env), JSON.stringify([4,5,6,7]));
    const knobs = L.cells.filter(c => c.line === 0).map(c => c.idx);
    eq('layout: line0 = the others', JSON.stringify(knobs), JSON.stringify([0,1,2,3]));
}
// Layout: scattered ADSR rearranged onto one line, leftovers on the other
{
    const page = [
        P('attack','Attack'), P('cutoff','Cut'), P('sustain','Sustain'), P('reso','Res'),
        P('decay','Decay'), P('glide','Glide'), P('release','Release'), P('tone','Tone'),
    ];
    const L = planPageLayout(page);
    eq('scattered: one envelope', L.envelopes.length, 1);
    const env = L.cells.filter(c => c.line === L.envelopes[0].line).map(c => c.idx);
    eq('scattered: a,d,s,r order', JSON.stringify(env), JSON.stringify([0,4,2,6]));
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `Cannot find module '../dist/esm/model/envelope.js'` (or build error: envelope.ts missing).

- [ ] **Step 4: Implement `src/model/envelope.ts`**

```ts
import type { KnobParam } from '../types/param.js';
import type { EnvelopeVM } from '../types/viewmodel.js';

export type EnvRole = 'a' | 'd' | 's' | 'r';
const ROLES: EnvRole[] = ['a', 'd', 's', 'r'];

/* Role keyword tables, matched whole-word, longest/most-specific first so
 * "attack" wins before the bare-letter pass. */
const ROLE_WORDS: Record<EnvRole, string[]> = {
    a: ['attack', 'atk', 'att'],
    d: ['decay', 'dcy', 'dec'],
    s: ['sustain', 'sus', 'sst'],
    r: ['release', 'rel', 'rls'],
};
const LETTER: Record<string, EnvRole> = { a: 'a', d: 'd', s: 's', r: 'r' };

function words(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/* Word/tag match → {role, qualifier}. Qualifier = the remaining words (the
 * envelope's identity, e.g. "f"/"filter"); '' for an unqualified set. */
function roleOf(p: KnobParam): { role: EnvRole; qualifier: string } | null {
    if (p.env) return { role: p.env, qualifier: '' };
    for (const text of [p.key, p.label]) {
        const ws = words(text);
        for (const role of ROLES) {
            for (const w of ROLE_WORDS[role]) {
                const i = ws.indexOf(w);
                if (i >= 0) return { role, qualifier: ws.filter((_, j) => j !== i).join(' ') };
            }
        }
    }
    return null;
}

export interface EnvGroup { a: number; d: number; s: number; r: number; name: string }

function qualName(q: string): string {
    if (!q) return 'Amp';
    if (q === 'f' || q === 'flt' || q === 'filter') return 'Filter';
    return q.charAt(0).toUpperCase() + q.slice(1);
}

/* Find every complete A/D/S/R group on a page (≤8 params). Word/tag matches
 * are grouped by qualifier; a single bare-letter group is added only when all
 * four letters a,d,s,r appear (the guard against false positives). */
export function detectEnvelopes(params: (KnobParam | null)[]): EnvGroup[] {
    const byQual = new Map<string, Partial<Record<EnvRole, number>>>();
    const claimed = new Set<number>();

    params.forEach((p, i) => {
        if (!p) return;
        const m = roleOf(p);
        if (!m) return;
        const g = byQual.get(m.qualifier) ?? {};
        if (g[m.role] === undefined) { g[m.role] = i; byQual.set(m.qualifier, g); claimed.add(i); }
    });

    const letters: Partial<Record<EnvRole, number>> = {};
    params.forEach((p, i) => {
        if (!p || claimed.has(i)) return;
        const k = words(p.key).join('');
        if (LETTER[k] && letters[LETTER[k]] === undefined) letters[LETTER[k]] = i;
    });
    if (ROLES.every(r => letters[r] !== undefined)) {
        const g = byQual.get('') ?? {};
        for (const r of ROLES) if (g[r] === undefined) g[r] = letters[r];
        byQual.set('', g);
    }

    const out: EnvGroup[] = [];
    for (const [qual, g] of byQual) {
        if (ROLES.every(r => g[r] !== undefined)) {
            out.push({ a: g.a!, d: g.d!, s: g.s!, r: g.r!, name: qualName(qual) });
        }
    }
    out.sort((x, y) => Math.min(x.a, x.d, x.s, x.r) - Math.min(y.a, y.d, y.s, y.r));
    return out;
}

export interface PageCell { line: 0 | 1; col: 0 | 1 | 2 | 3; idx: number }
export interface PageLayout { cells: PageCell[]; envelopes: { line: 0 | 1; name: string }[] }

/* Decide which knob line each envelope occupies and where the remaining params
 * sit. Each cell keeps its page-relative index (idx) so touch/value stay mapped
 * to the physical knob even when params are rearranged onto one line. */
export function planPageLayout(params: (KnobParam | null)[]): PageLayout {
    const envs = detectEnvelopes(params);
    const envCols: (number[] | null)[] = [null, null];
    const info: { line: 0 | 1; name: string }[] = [];
    const used = new Set<number>();
    const claimed = new Set<number>();

    for (const e of envs) {
        if (info.length >= 2) break;
        const desired = (Math.floor(Math.min(e.a, e.d, e.s, e.r) / 4)) as 0 | 1;
        let line: 0 | 1 = used.has(desired) ? ((desired ^ 1) as 0 | 1) : desired;
        if (used.has(line)) continue;
        used.add(line);
        envCols[line] = [e.a, e.d, e.s, e.r];
        info.push({ line, name: e.name });
        for (const i of [e.a, e.d, e.s, e.r]) claimed.add(i);
    }

    const leftover: number[] = [];
    params.forEach((p, i) => { if (p && !claimed.has(i)) leftover.push(i); });

    const cells: PageCell[] = [];
    let li = 0;
    for (let line = 0 as 0 | 1; line <= 1; line = (line + 1) as 0 | 1) {
        if (envCols[line]) {
            envCols[line]!.forEach((idx, col) => cells.push({ line, col: col as 0 | 1 | 2 | 3, idx }));
        } else {
            for (let col = 0; col <= 3 && li < leftover.length; col++) {
                cells.push({ line, col: col as 0 | 1 | 2 | 3, idx: leftover[li++] });
            }
        }
        if (line === 1) break;
    }
    return { cells, envelopes: info };
}
```

- [ ] **Step 5: Wire the `env` tag through the config path**

In `src/model/hierarchy.ts`, inside the custom-config `param` object (around line 122-131), add the field so a JSON `env` tag reaches the param:
```ts
                    const param: KnobParam = {
                        key:        slot.key,
                        label:      slot.full || cp.name || hier.label || slot.key,
                        shortLabel: slot.short ?? null,
                        type:       type as KnobParam['type'],
                        options, min, max, step, renderStyle,
                        env:        slot.env,
                        automatable: (type === 'float' || type === 'int') && max > min && !bank.global,
                    };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — all "Envelope detection" assertions green, 0 failures overall.

- [ ] **Step 7: Commit**

```bash
git add src/types/param.ts src/types/viewmodel.ts src/model/envelope.ts src/model/hierarchy.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(movy): ADSR envelope detection + page layout planner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: ViewModel integration

**Files:**
- Modify: `src/model/viewmodel.ts` (use `planPageLayout`; set `envelopeLines`; key `touched` off page-relative index)
- Test: `browser-test/logic.mjs` (append "── Envelope viewmodel ──" block)

**Interfaces:**
- Consumes: `planPageLayout`, `EnvelopeVM` (Task 1).
- Produces: `vm.envelopeLines` populated; `vm.rows[line][col]` ordered A,D,S,R on envelope lines; `vm.rows[line][col].touched` reflects the param's physical knob.

- [ ] **Step 1: Write the failing viewmodel test**

Append to `browser-test/logic.mjs`:
```js
_log('\n── Envelope viewmodel ──');
// test8: row1 = attack/decay/sustain/release → envelope on line 1
{
    const m = bootModel(MOCK_SYNTHS.test8);
    const vm = m.getViewModel();
    eq('test8: line1 is envelope', !!vm.envelopeLines?.[1], true);
    eq('test8: line0 not envelope', !!vm.envelopeLines?.[0], false);
    eq('test8: line1 col0 = Atk', vm.rows[1][0]?.shortName, 'ATK');
    eq('test8: line1 col3 = Rel', vm.rows[1][3]?.shortName, 'REL');
    eq('test8: line0 col0 = Freq', vm.rows[0][0]?.shortName, 'FREQ');
}
// test16: no ADSR → no envelope
{
    const m = bootModel(MOCK_SYNTHS.test16);
    eq('test16: no envelope line0', !!m.getViewModel().envelopeLines?.[0], false);
    eq('test16: no envelope line1', !!m.getViewModel().envelopeLines?.[1], false);
}
// Touch maps to the right cell on the envelope line (knob 6 = sustain)
{
    const m = bootModel(MOCK_SYNTHS.test8);
    m.handleKnobTouch(6);
    const vm = m.getViewModel();
    eq('test8: touching knob6 marks Sus cell', vm.rows[1][2]?.touched, true);
    eq('test8: Atk cell not touched', vm.rows[1][0]?.touched, false);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `vm.envelopeLines` undefined (`!!undefined` → false ≠ true) on the test8 assertions.

- [ ] **Step 3: Rewrite the row-building section of `buildViewModel`**

In `src/model/viewmodel.ts`, add the import:
```ts
import { planPageLayout } from './envelope.js';
import type { EnvelopeVM } from '../types/viewmodel.js';
```
Replace the `const rows: ViewModel['rows'] = [[], []];` block and its `for (let row...)` double loop (current lines ~34-89) with:
```ts
    const layout = planPageLayout(s.knobParams.slice(pageStart, pageStart + KNOBS_PER_PAGE));
    const rows: ViewModel['rows'] = [[null, null, null, null], [null, null, null, null]];
    const envelopeLines: (EnvelopeVM | null)[] = [null, null];
    for (const e of layout.envelopes) envelopeLines[e.line] = { name: e.name };

    for (const cell of layout.cells) {
        const physK = cell.idx;                 // page-relative index == physical knob
        const gi    = pageStart + physK;
        const p     = s.knobParams[gi];
        if (!p) continue;
        const v  = s.knobValues[gi];
        const renorm = (val: number) => (p.min === p.max)
            ? 0 : Math.max(0, Math.min(1, (val - p.min) / (p.max - p.min)));
        const nv = (v === null || v === undefined) ? 0 : renorm(v);
        const enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
        const dv = p.type === 'file'
            ? (s.fileValues[gi] ? basename(s.fileValues[gi] as string) : '—')
            : p.nameKey
                ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, v))
                : formatValue(p, v);
        const lane = auto.laneForKey(p.key);
        const automated = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
        // An automation edit drives BOTH the value text (inverted, like a knob
        // touch) and the arc/envelope position, without touching the base value.
        let touched = s.touchedSlots.includes(physK);
        let displayValue = dv;
        let arcValue = nv;
        if (auto.held && lane >= 0 && auto.heldValues.has(lane)) {
            const hv = auto.heldValues.get(lane) as number;
            touched = true; displayValue = formatValue(p, hv); arcValue = renorm(hv);
        } else if (!auto.held && lane >= 0 && auto.liveValues.has(lane)) {
            const lv = auto.liveValues.get(lane) as number;
            touched = true; displayValue = formatValue(p, lv); arcValue = renorm(lv);
        }
        rows[cell.line][cell.col] = {
            shortName:       shortNames[physK],
            fullName:        p.label,
            type:            p.type,
            normalizedValue: arcValue,
            displayValue,
            touched,
            isLongEnum:      p.type === 'enum' && (p.options?.length ?? 0) > 6,
            options:         p.options,
            enumIndex:       enumIdx,
            renderStyle:     p.renderStyle,
            automated,
            automatable:     p.automatable,
            assigned:        lane >= 0,
        };
    }
```
Then add `envelopeLines,` to the returned object (next to `rows,`):
```ts
        rows,
        envelopeLines,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — envelope viewmodel block green; all pre-existing logic assertions still pass.

- [ ] **Step 5: Run the full local suite (no rendering change yet)**

Run: `cd movy && node browser-test/app-loop.mjs`
Expected: PASS (the viewmodel refactor preserves row contents for non-ADSR pages).

- [ ] **Step 6: Commit**

```bash
git add src/model/viewmodel.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(movy): build envelope lines into the knobs viewmodel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Shared draw primitives

**Files:**
- Create: `src/renderer/primitives.ts`
- Modify: `src/renderer/knob.ts` (remove local `drawLine`, import it)
- Verify: `browser-test/screenshot.mjs` (baselines must be byte-identical — pure refactor)

**Interfaces:**
- Produces: `drawLine(x0,y0,x1,y1)`, `drawDot(x,y)` (2×2 filled), `drawDottedV(x,y0,y1)` (every-other-pixel vertical).

- [ ] **Step 1: Create `src/renderer/primitives.ts`**

```ts
/* Shared 1-bit raster primitives (device fill_rect-backed). Pure: same args →
 * same pixels. Extracted so the knob and envelope renderers share one line
 * routine (no duplication). */

export function drawLine(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
        fill_rect(x0, y0, 1, 1, 1);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

/* Bold 2×2 vertex marker, top-left anchored at (x,y). */
export function drawDot(x: number, y: number): void {
    fill_rect(x, y, 2, 2, 1);
}

/* Dotted vertical from y0 to y1 (inclusive), lit on every other row. */
export function drawDottedV(x: number, y0: number, y1: number): void {
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    for (let y = lo; y <= hi; y += 2) fill_rect(x, y, 1, 1, 1);
}
```

- [ ] **Step 2: Refactor `knob.ts` to use the shared line**

In `src/renderer/knob.ts`: delete the local `function drawLine(...) {...}` (lines ~21-32) and add to the imports:
```ts
import { drawLine } from './primitives.js';
```

- [ ] **Step 3: Build and verify screenshots are unchanged**

Run: `cd movy && npm run build:browser && node browser-test/screenshot.mjs`
Expected: PASS — 0 diffs (pure refactor; arc-knob output identical).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/primitives.ts src/renderer/knob.ts
git commit -m "$(cat <<'EOF'
refactor(movy): extract shared raster primitives (drawLine/dot/dottedV)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Envelope renderer + integration + screenshots + perf

**Files:**
- Create: `src/renderer/envelope.ts`
- Modify: `src/renderer/label.ts` (`drawKnobRow`/`drawKnobParams` handle envelope lines)
- Modify: `browser-test/mock-synth.mjs` (add `env_dual`)
- Modify: `browser-test/screenshot.mjs` (new presets + regenerate affected baselines)
- Modify: `browser-test/perf.mjs` (bounded fill_rect for an envelope page)

**Interfaces:**
- Consumes: `ParamVM` normalized values from `vm.rows[line][0..3]`, `vm.envelopeLines` (Task 2), primitives (Task 3).
- Produces: `drawEnvelope(rowY: number, adsr: (ParamVM | null)[]): void`.

- [ ] **Step 1: Create `src/renderer/envelope.ts`**

```ts
import type { ParamVM } from '../types/viewmodel.js';
import { drawLine, drawDot, drawDottedV } from './primitives.js';
import { W } from './layout.js';

/* Single ADSR envelope across the full line width. adsr = [A,D,S,R] ParamVMs
 * (column order guaranteed by the layout planner). Each param drives one vertex
 * in one direction: A→peak x, D→sustain-start x, S→plateau y (level), R→end x.
 * Gate-off is a fixed reference x so release is always visible. */
export function drawEnvelope(rowY: number, adsr: (ParamVM | null)[]): void {
    const a = adsr[0]?.normalizedValue ?? 0;
    const d = adsr[1]?.normalizedValue ?? 0;
    const s = adsr[2]?.normalizedValue ?? 0;
    const r = adsr[3]?.normalizedValue ?? 0;

    const baseY = rowY + 14, topY = rowY + 1;
    const usableH = baseY - topY;                 // 13px of vertical travel
    const gateX = 88;                             // fixed note-off reference

    const startX = 2;
    const peakX  = startX + Math.round(a * 26);                       // 2..28
    let sustStartX = peakX + 4 + Math.round(d * 24);
    if (sustStartX > gateX - 2) sustStartX = gateX - 2;
    const susY   = baseY - Math.round(s * usableH);                   // sustain level
    let relEndX  = gateX + 4 + Math.round(r * 33);
    if (relEndX > W - 2) relEndX = W - 2;                             // 92..126

    drawLine(startX, baseY, peakX, topY);          // attack rise
    drawLine(peakX, topY, sustStartX, susY);       // decay fall
    drawLine(sustStartX, susY, gateX, susY);       // sustain plateau
    drawLine(gateX, susY, relEndX, baseY);         // release fall

    // Dotted verticals highlight the plateau timing (the two middle corners).
    drawDottedV(sustStartX, susY, baseY);
    drawDottedV(gateX, susY, baseY);

    // Bold vertex dots, nudged so the 2×2 marker straddles the vertex.
    drawDot(Math.max(0, peakX - 1), topY);
    drawDot(sustStartX - 1, Math.max(rowY, susY - 1));
    drawDot(gateX - 1, Math.max(rowY, susY - 1));
    drawDot(Math.min(W - 2, relEndX - 1), baseY - 1);
}
```

- [ ] **Step 2: Integrate into `label.ts`**

In `src/renderer/label.ts`, add the import:
```ts
import { drawEnvelope } from './envelope.js';
```
Change `drawKnobRow` to take an `env` flag and skip widgets when set:
```ts
export function drawKnobRow(
    params: (ParamVM | null)[], rowY: number, lblY: number,
    held = false, poolFull = false, env = false,
): void {
    if (env) drawEnvelope(rowY, params);
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        if (hiddenDuringHold(pvm, held, poolFull)) continue;
        if (!env) drawKnobWidget(col, rowY, pvm);
        drawLabelCell(col, lblY, pvm);
    }
}
```
And pass the flags in `drawKnobParams`:
```ts
        drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y, vm.automationHeld, vm.automationPoolFull, !!vm.envelopeLines?.[0]);
        drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y, vm.automationHeld, vm.automationPoolFull, !!vm.envelopeLines?.[1]);
```

- [ ] **Step 3: Add the `env_dual` mock**

In `browser-test/mock-synth.mjs`, add inside `MOCK_SYNTHS` (after `test16`):
```js
    env_dual: {
        "synth:name": "Dual Env",
        "synth:ui_hierarchy": hier([
            { key: "attack",   label: "Attack",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "decay",    label: "Decay",    type: "float", min: 0, max: 1, step: 0.01 },
            { key: "sustain",  label: "Sustain",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "release",  label: "Release",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "f_attack", label: "F Attack", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "f_decay",  label: "F Decay",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "f_sustain","label": "F Sustain", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "f_release","label": "F Release", type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        "synth:attack": "0.10",  "synth:decay": "0.35", "synth:sustain": "0.70", "synth:release": "0.45",
        "synth:f_attack": "0.40","synth:f_decay": "0.25","synth:f_sustain": "0.30","synth:f_release": "0.20",
    },
```

- [ ] **Step 4: Register the new screenshots**

In `browser-test/screenshot.mjs`, add to `PRESETS`:
```js
    'env_dual', 'env_touched',
```
add to `BASE`:
```js
    env_dual: 'env_dual', env_touched: 'env_dual',
```
and add cases to the `applyView` switch:
```js
        case 'env_dual':    forceRender(); break;
        case 'env_touched': model.handleKnobTouch(2); forceRender(); break;   // touch Sustain
```

- [ ] **Step 5: Generate/refresh baselines and inspect**

Run: `cd movy && npm run build:browser && node browser-test/screenshot.mjs --update`
Then review the changed PNGs under `browser-test/screenshots/baseline/`. Expected changes, and nothing else:
- **New:** `env_dual` (two stacked envelopes), `env_touched` (top envelope + Sustain cell showing its value inverted).
- **Changed to an envelope on the ADSR line:** `obxd_main_page` (amp ADSR, line 1), `obxd_filter_page` (filter ADSR, line 0, line 1 empty), and the `test8`-backed frames `knob_toast`, `auto_dot`, `auto_held`, `auto_live`, `auto_limit`, `knobs_jog_toast`, `chain_synth`, `chain_jog_toast`, `chain_t2`, `chain_t4`, `step_indicator` (row 1 becomes the envelope; row-0 knobs / toast / automation dot unchanged).
- **Unchanged:** all `main-*`, `clip-*`, `step_page_*`, `test8`/`test16` plain pages without an ADSR line, `no_params`, `keys_view`, `browse_view`.

If any frame outside that list changed, stop and investigate before continuing.

- [ ] **Step 6: Re-run the compare to confirm green**

Run: `cd movy && node browser-test/screenshot.mjs`
Expected: PASS — 0 diffs.

- [ ] **Step 7: Add a perf assertion for an envelope page**

In `browser-test/perf.mjs`, after the existing fill_rect check, add (mirroring the existing render-count harness pattern — load `env_dual`, render, count):
```js
/* An envelope line must draw FEWER rects than the 4 arc knobs it replaces. */
const ENVELOPE_FILL_RECT_MAX = 400;
{
    mockState = {};
    Object.assign(mockState, MOCK_SYNTHS.env_dual);
    const m = createModel(0, 'synth');
    m.reload(); m.tick(); m.tick();
    fillRectCount = 0;
    renderKnobsView(m.getViewModel());
    check('envelope page fill_rect', fillRectCount, ENVELOPE_FILL_RECT_MAX);
}
```

- [ ] **Step 8: Run the full local suite**

Run: `cd movy && npm test`
Expected: PASS — logic, app-loop, screenshot, perf all 0 failures.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/envelope.ts src/renderer/label.ts browser-test/mock-synth.mjs browser-test/screenshot.mjs browser-test/perf.mjs browser-test/screenshots/baseline
git commit -m "$(cat <<'EOF'
feat(movy): render ADSR params as an envelope graphic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Audit existing layouts, device verify, finalize

**Files:**
- Read-only audit: `src/modules/*.json`, `schwung-obxd/src/module.json`, `schwung-moog/src/module.json`
- Possibly modify: a `src/modules/*.json` only if a full ADSR there is missed by auto-detection.

**Interfaces:** none (verification task).

- [ ] **Step 1: Audit bundled configs for full ADSR sets**

Run: `cd movy && for f in src/modules/*.json; do echo "== $f =="; grep -iE 'attack|decay|sustain|release' "$f"; done`
Expected: only partial sets (e.g. wurl/plaits attack+decay) — **no config has all four roles**, so none needs an explicit `env` tag. OB-Xd and Moog use standard names read live from the device hierarchy and are covered by auto-detection (verified by the `obxd_like` screenshots in Task 4). If any bundled config *does* have a full ADSR with non-standard names, add `"env": "a|d|s|r"` to those four slots and regenerate that module's screenshot.

- [ ] **Step 2: Typecheck**

Run: `cd movy && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Device test (if reachable)**

Run:
```bash
cd movy && ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: PASS, or report **DEVICE OFFLINE** in CAPS. On device, open OB-Xd/Moog and confirm the ADSR line shows the envelope and turning attack/decay/sustain/release moves the expected vertex with the value toast.

- [ ] **Step 4: Final full local run**

Run: `cd movy && npm test`
Expected: PASS — 0 failures across all suites.

- [ ] **Step 5: Commit any audit changes and push**

```bash
git add -A src/modules
git commit -m "$(cat <<'EOF'
chore(movy): audit module configs for ADSR envelope coverage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)" || echo "no config changes needed"
git push
```

---

## Self-Review

**Spec coverage:**
- Single envelope replacing 4 knobs, on one line → Tasks 2,4. ✓
- Names in normal label positions, knob behaviour (invert/value/toast) → label cells untouched; `touched` keyed by page-relative index (Task 2). ✓
- Activation via custom JSON (`env` tag) and via uniform A/D/S/R names (short/long/letters/`f_` prefix) → Task 1 detection + hierarchy wiring. ✓
- "Only if all 4 recognized" + single-letter guard → Task 1 detection + tests. ✓
- Rearrange when on different lines → `planPageLayout` + scattered test (Task 1), page-relative touch (Task 2). ✓
- Two envelopes (filter + amp) on two lines → `env_dual` mock + screenshot (Task 4), dual-group test (Task 1). ✓
- Expressive graphic: lines, bold connection dots, dotted verticals, per-param direction → `drawEnvelope` (Task 4). ✓
- Apply to existing schwung layouts where needed → Task 5 audit; OB-Xd/Moog via auto-detection (Task 4 fixtures). ✓
- Tests: logic, screenshot, perf, device → Tasks 1,2,4,5. ✓

**Placeholder scan:** none — every step has concrete code/commands and expected output.

**Type consistency:** `EnvRole`, `EnvGroup`, `PageCell`, `PageLayout`, `EnvelopeVM`, `detectEnvelopes`, `planPageLayout`, `drawEnvelope`, `KnobParam.env`, `KnobSlot.env`, `ViewModel.envelopeLines` are defined in Task 1/3 and used consistently in Tasks 2/4. `drawKnobRow` gains a trailing `env` param with all call sites updated in Task 4.
