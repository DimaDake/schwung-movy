# Recursive Hierarchy Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `loadHierarchy`'s generic path recursively expand navigation-only levels (levels with `params` sub-level entries but no `knobs`), so all controllable parameters in any Schwung module are reachable as movy knob banks.

**Architecture:** Single change to `src/model/hierarchy.ts` — replace the flat root.params scan with a recursive helper `addLevelOrExpand` that walks nav-only levels into their sub-levels. Level names are prefixed with an abbreviated parent name (e.g. `"Mod/Pitch"`, `"ModS/LFO"`). A `visitedLevels` Set prevents loops.

**Tech Stack:** TypeScript, ESM, movy browser-test harness (`node browser-test/logic.mjs`)

---

### Task 1: Add `nav_levels` mock and failing tests

**Files:**
- Modify: `browser-test/mock-synth.mjs`
- Modify: `browser-test/logic.mjs`

- [ ] **Step 1: Add `nav_levels` mock to `mock-synth.mjs`**

Add the following entry to the `MOCK_SYNTHS` export object in `browser-test/mock-synth.mjs`, after the `obxd_like` entry:

```javascript
nav_levels: {
    "synth:name": "NavTest",
    "synth:ui_hierarchy": JSON.stringify({
        levels: {
            root: {
                knobs: ["main_a", "main_b"],
                params: [
                    { label: "Main", level: "main" },
                    { label: "Mod",  level: "mod"  },
                ],
            },
            main: {
                name: "Main",
                knobs: ["main_a", "main_b", "main_c", "main_d"],
            },
            mod: {
                name: "Mod",
                params: [
                    { label: "Pitch", level: "pitch_mod" },
                    { label: "Filt",  level: "filt_mod"  },
                ],
            },
            pitch_mod: {
                name: "Pitch",
                knobs: ["pm_lfo", "pm_env", "pm_vel"],
            },
            filt_mod: {
                name: "Filter",
                knobs: ["fm_lfo", "fm_env", "fm_vel"],
            },
        },
    }),
    "synth:chain_params": JSON.stringify([
        { key: "main_a", name: "Main A", type: "float", min: 0, max: 1 },
        { key: "main_b", name: "Main B", type: "float", min: 0, max: 1 },
        { key: "main_c", name: "Main C", type: "float", min: 0, max: 1 },
        { key: "main_d", name: "Main D", type: "float", min: 0, max: 1 },
        { key: "pm_lfo", name: "LFO",    type: "float", min: -1, max: 1 },
        { key: "pm_env", name: "Env",    type: "float", min: -1, max: 1 },
        { key: "pm_vel", name: "Vel",    type: "float", min: -1, max: 1 },
        { key: "fm_lfo", name: "LFO",    type: "float", min: -1, max: 1 },
        { key: "fm_env", name: "Env",    type: "float", min: -1, max: 1 },
        { key: "fm_vel", name: "Vel",    type: "float", min: -1, max: 1 },
    ]),
    "synth:main_a": "0.5", "synth:main_b": "0.5",
    "synth:main_c": "0.5", "synth:main_d": "0.5",
    "synth:pm_lfo": "0.0", "synth:pm_env": "0.0", "synth:pm_vel": "0.0",
    "synth:fm_lfo": "0.0", "synth:fm_env": "0.0", "synth:fm_vel": "0.0",
},
```

This mock has:
- `mod` = navigation-only level (no `knobs`, has sub-level `params`)
- `pitch_mod` and `filt_mod` = leaf levels with actual `knobs`
- Expected banks after fix: `Main` (root.knobs), `Main` (main level), `Mod/Pitch`, `Mod/Filter`

- [ ] **Step 2: Add failing tests to `logic.mjs`**

Add the following test block to `browser-test/logic.mjs` after the existing `bankCount and bankName` section (around line 93), before `isEmpty`:

```javascript
/* ── nav-only level expansion ─────────────────────────────────────────────── */

_log('\nTest: navigation-only levels expand recursively');

{
    const m = bootModel(MOCK_SYNTHS.nav_levels);
    eq('nav_levels: bankCount = 4', m.getViewModel().bankCount, 4);

    const names = [];
    for (let i = 0; i < 4; i++) {
        if (i > 0) m.changePage(1);
        names.push(m.getViewModel().bankName);
    }
    eq('nav_levels: bank 0 = Main',       names[0], 'Main');
    eq('nav_levels: bank 1 = Main',       names[1], 'Main');
    eq('nav_levels: bank 2 = Mod/Pitch',  names[2], 'Mod/Pitch');
    eq('nav_levels: bank 3 = Mod/Filter', names[3], 'Mod/Filter');
    eq('nav_levels: no bare Mod bank',    names.includes('Mod'), false);

    // page 2 (Mod/Pitch) should expose 3 params
    m.changePage(-1);
    eq('nav_levels: Mod/Pitch has 3 params',
        m.getViewModel().rows.flat().filter(Boolean).length, 3);
}
```

- [ ] **Step 3: Build browser modules**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser
```

Expected: exit 0, `dist/esm/` updated.

- [ ] **Step 4: Run tests to confirm they fail**

```bash
cd /Users/dake/git/cld/movy && node browser-test/logic.mjs
```

Expected: failures on the `nav_levels` assertions (bankCount, bank names). All pre-existing tests should still pass.

---

### Task 2: Implement recursive expansion in `hierarchy.ts`

**Files:**
- Modify: `src/model/hierarchy.ts`

- [ ] **Step 1: Add `name?: string` to `HierLevel` interface**

In `src/model/hierarchy.ts`, find the `HierLevel` interface (around line 7) and add `name?: string` as the first field:

Old:
```typescript
interface HierLevel {
    knobs?: (string | HierParam)[];
    params?: (string | HierParam)[];
    list_param?: string; count_param?: string; name_param?: string;
    items_param?: string; select_param?: string;
}
```

New:
```typescript
interface HierLevel {
    name?: string;
    knobs?: (string | HierParam)[];
    params?: (string | HierParam)[];
    list_param?: string; count_param?: string; name_param?: string;
    items_param?: string; select_param?: string;
}
```

- [ ] **Step 2: Replace the flat sub-level scan with a recursive helper**

Find the block that begins with the comment `/* Sub-levels from root.params order` (around line 184) and ends with the closing `}` of the if-block (around line 193):

Old (lines 184–193):
```typescript
    /* Sub-levels from root.params order — skip navigation-only levels (no knobs) */
    if (Array.isArray(rootLevel.params)) {
        for (const entry of rootLevel.params) {
            if (typeof entry !== 'object' || !entry.level) continue;
            const lvl = allLevels[entry.level];
            if (!lvl || !Array.isArray(lvl.knobs) || lvl.knobs.length === 0) continue;
            const keys = lvl.knobs.map(toKey).filter((k): k is string => k !== null);
            if (keys.length > 0) addLevel(levelLabel[entry.level] || entry.level, keys);
        }
    }
```

New:
```typescript
    /* Sub-levels from root.params — recurse into navigation-only levels */
    function levelNameToPrefix(name: string): string {
        const words = name.split(/\s+/).filter(Boolean);
        if (words.length === 0) return '';
        if (words.length === 1) return words[0].slice(0, 6);
        return (words[0].slice(0, 4) + words.slice(1).map(w => w[0].toUpperCase()).join('')).slice(0, 6);
    }

    const visitedLevels = new Set<string>();

    function addLevelOrExpand(levelKey: string, prefix: string | null, depth: number): void {
        if (depth > 2 || visitedLevels.has(levelKey)) return;
        visitedLevels.add(levelKey);
        const lvl = allLevels[levelKey];
        if (!lvl) return;
        const name  = lvl.name || levelLabel[levelKey] || levelKey;
        const label = prefix ? prefix + '/' + name : name;
        if (Array.isArray(lvl.knobs) && lvl.knobs.length > 0) {
            const keys = lvl.knobs.map(toKey).filter((k): k is string => k !== null);
            if (keys.length > 0) addLevel(label, keys);
        } else if (Array.isArray(lvl.params)) {
            const nextPrefix = levelNameToPrefix(name);
            for (const sub of lvl.params) {
                if (typeof sub !== 'object' || !sub.level) continue;
                addLevelOrExpand(sub.level, nextPrefix, depth + 1);
            }
        }
    }

    if (Array.isArray(rootLevel.params)) {
        for (const entry of rootLevel.params) {
            if (typeof entry !== 'object' || !entry.level) continue;
            addLevelOrExpand(entry.level, null, 0);
        }
    }
```

- [ ] **Step 3: Build browser modules**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 4: Run logic tests**

```bash
cd /Users/dake/git/cld/movy && node browser-test/logic.mjs
```

Expected: `ALL LOGIC CHECKS PASSED`, 0 failures. All nav_levels assertions should now pass.

- [ ] **Step 5: Run all local tests**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs && node browser-test/perf.mjs
```

Expected: 0 screenshot failures and 0 perf regressions. (Screenshot baselines are unaffected — no rendering change.)

- [ ] **Step 6: Run typecheck**

```bash
cd /Users/dake/git/cld/movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/model/hierarchy.ts browser-test/mock-synth.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat: recursively expand navigation-only hierarchy levels

Levels with params sub-entries but no knobs (e.g. MrHyde's mod/mod_sources)
were silently skipped. addLevelOrExpand now recurses into sub-levels and
prefixes their bank names (Mod/Pitch, ModS/LFO, etc.).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 3: Device verification

**Files:** None

- [ ] **Step 1: Check device reachability and deploy**

```bash
cd /Users/dake/git/cld/movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

Expected: PASS on all automated device checks. If device is offline, report it.

- [ ] **Step 2: Manual verification with MrHyde**

With MrHyde loaded in a chain slot, open movy and jog through the banks. Verify:
- Banks for `Mod/Pitch`, `Mod/Harmonics`, `Mod/Timbre`, `Mod/Cutoff`, `Mod/Assign 1`, `Mod/Assign 2` appear and show knobs
- Banks for `ModS/LFO`, `ModS/Envelope`, `ModS/Cycling Envelope`, `ModS/Random`, `ModS/Velocity`, `ModS/Poly Aftertouch` appear
- Turning knobs on any of these pages sends parameter changes (check log: `ssh ableton@move.local 'tail -f /data/UserData/schwung/debug.log | grep "\[movy\]"'`)
- No existing modules (Plaits, Wurl) are broken — they use the custom-config early-return path and are unaffected

---

## Notes

- `hierarchy.ts` is already 224 lines (over the 200-line guideline). This change adds ~20 net lines. A follow-on file split is tracked separately and is not part of this task.
- The `visitedLevels` set guards against malformed hierarchies with cycles. Max depth 2 covers the two-level nesting (root → nav-only → leaf) seen in MrHyde; deeper nesting silently stops expanding rather than recursing infinitely.
- MrHyde's module id is `freak` (`module.json: "id": "freak"`). No `freak.json` config exists in movy; it hits the generic path. Custom configs for per-module layout optimization are future work.
