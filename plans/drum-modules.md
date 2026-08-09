# Drum Module Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drum module support — bundled configs for 5 modules, per-pad parameter pages, and a small pad-grid icon left of the bank name for pad-specific pages.

**Architecture:** Five JSON configs (mrdrums, weird-dreams, krautdrums, libpo32, essaim) are registered in `loader.ts` alongside existing synth configs. `loadHierarchy` reads the `drum` metadata to set drum state on `ModelState`. Physical pad hits (68–99) route to a new `drumPadOn` function that updates `drumCurrentPad` and optionally silences MIDI on shift. A `drawPadGridIcon` helper in `header.ts` renders a 6×6 or 6×4 bordered mini-grid to the left of the bank name for `padSpecific` banks.

**Tech Stack:** TypeScript, esbuild, QuickJS (device), Node.js (tests)

---

## File Map

| File | Action |
|------|--------|
| `src/types/param.ts` | Add `DrumConfig`, `padSpecific?` to `BankConfig`, `drum?` to `ModuleConfig` |
| `src/model/state.ts` | Add `isDrum`, `drumPadCount`, `drumCurrentPad`, `drumCurrentPhysPad` to `ModelState` and init |
| `src/types/viewmodel.ts` | Add `drumPadCount`, `drumCurrentPad`, `isPadSpecific` to `ViewModel` |
| `src/model/hierarchy.ts` | Populate drum fields from `moduleConfig.drum` |
| `src/model/viewmodel.ts` | Populate drum fields in `buildViewModel` |
| `src/model/index.ts` | Expose `getDrumConfig()` and `updateDrumPad()` on the model |
| `src/modules/mrdrums.json` | New — full bank config for MrDrums (16-pad) |
| `src/modules/weird-dreams.json` | New — full bank config for Weird Dreams (8-pad) |
| `src/modules/krautdrums.json` | New — full bank config for KrautDrums |
| `src/modules/libpo32.json` | New — full bank config for Libpo32 |
| `src/modules/essaim.json` | New — full bank config for Essaim |
| `src/modules/loader.ts` | Register all 5 new configs |
| `src/keyboard/drum-handler.ts` | New — `drumPadOn()`, `drumPadOff()` |
| `src/midi/router.ts` | Dispatch pad notes to drum handler when `isDrum` |
| `src/renderer/header.ts` | Add `drawPadGridIcon()` |
| `src/renderer/knob-view.ts` | Render pad icon left of bank name for `padSpecific` banks |
| `browser-test/logic.mjs` | Drum logic tests (hierarchy load, viewmodel, drumPadOn) |
| `browser-test/screenshot.mjs` | Screenshot tests for padSpecific bank with icon |

---

## Task 1: Type Definitions

**Files:**
- Modify: `src/types/param.ts`
- Modify: `src/model/state.ts`
- Modify: `src/types/viewmodel.ts`

- [ ] **Step 1: Update `src/types/param.ts`**

Replace the existing interfaces with these updated versions (add new fields, keep all existing fields):

```typescript
export interface KnobSlot {
    key:            string;
    short:          string;
    full:           string;
    type:           'float' | 'int' | 'enum' | 'file';
    render?:        'arc' | 'hbar' | 'vbar';
    options?:       string[];
    min?:           number;
    max?:           number;
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
}

export interface BankConfig {
    name:         string;
    rows:         (KnobSlot | null)[][];
    padSpecific?: boolean;
}

export interface DrumConfig {
    padCount:         number;
    padNoteStart:     number;
    rawMidi:          boolean;
    currentPadParam?: string;
    shiftSelectMidi?: boolean;
}

export interface ModuleConfig {
    id:    string;
    name:  string;
    banks: BankConfig[];
    drum?: DrumConfig;
}

export interface KnobParam {
    key:            string;
    label:          string;
    shortLabel:     string | null;
    type:           'float' | 'int' | 'enum' | 'file';
    min:            number;
    max:            number;
    step:           number;
    options:        string[] | null;
    nameKey?:       string;
    renderStyle:    'arc' | 'hbar' | 'vbar';
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
}
```

- [ ] **Step 2: Add drum fields to `ModelState` and init in `createModelState`**

In `src/model/state.ts`, add to the `ModelState` interface:
```typescript
isDrum:             boolean;
drumPadCount:       number;
drumCurrentPad:     number;
drumCurrentPhysPad: number;
```

In `createModelState`, add to the returned object:
```typescript
isDrum:             false,
drumPadCount:       0,
drumCurrentPad:     1,
drumCurrentPhysPad: 0,
```

- [ ] **Step 3: Add drum fields to `ViewModel`**

In `src/types/viewmodel.ts`, add to the `ViewModel` interface:
```typescript
drumPadCount:    number;
drumCurrentPad:  number;
isPadSpecific:   boolean;
```

- [ ] **Step 4: Build and typecheck**

```bash
cd movy && npm run build && npm run typecheck
```

Expected: zero errors. Fix any type errors before continuing.

- [ ] **Step 5: Commit**

```bash
cd movy
git add src/types/param.ts src/model/state.ts src/types/viewmodel.ts
git commit -m "$(cat <<'EOF'
feat(drum): add DrumConfig, padSpecific, and drum ViewModel types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Drum Module JSON Configs

**Files:**
- Create: `src/modules/mrdrums.json`
- Create: `src/modules/weird-dreams.json`
- Create: `src/modules/krautdrums.json`
- Create: `src/modules/libpo32.json`
- Create: `src/modules/essaim.json`
- Modify: `src/modules/loader.ts`

- [ ] **Step 1: Create `src/modules/mrdrums.json`**

```json
{
  "id": "mrdrums",
  "name": "MrDrums",
  "drum": {
    "padCount": 16,
    "padNoteStart": 36,
    "rawMidi": false,
    "currentPadParam": "ui_current_pad"
  },
  "banks": [
    {
      "name": "Main",
      "padSpecific": true,
      "rows": [
        [
          { "key": "pad_sample_path", "short": "SAMPL", "full": "Sample",   "type": "file", "fileRoot": "/data/UserData", "fileFilter": [".wav"], "fileStartPath": "/data/UserData/UserLibrary/Samples" },
          { "key": "pad_vol",         "short": "VOL",   "full": "Volume",   "type": "float", "min": 0, "max": 1 },
          { "key": "pad_pan",         "short": "PAN",   "full": "Pan",      "type": "float", "min": -1, "max": 1 },
          { "key": "pad_tune",        "short": "TUNE",  "full": "Tune",     "type": "float", "min": -24, "max": 24 }
        ],
        [
          { "key": "pad_start",       "short": "START", "full": "Start",    "type": "float", "min": 0, "max": 1 },
          { "key": "pad_attack_ms",   "short": "ATTK",  "full": "Attack",   "type": "float", "min": 0, "max": 500 },
          { "key": "pad_decay_ms",    "short": "DECAY", "full": "Decay",    "type": "float", "min": 0, "max": 5000 },
          { "key": "pad_mode",        "short": "MODE",  "full": "Mode",     "type": "enum", "options": ["oneshot", "loop", "gate"] }
        ]
      ]
    },
    {
      "name": "Rand",
      "padSpecific": true,
      "rows": [
        [
          { "key": "pad_rand_pan_amt",   "short": "RNDPN", "full": "Rnd Pan",   "type": "float", "min": 0, "max": 1 },
          { "key": "pad_rand_vol_amt",   "short": "RNDVL", "full": "Rnd Vol",   "type": "float", "min": 0, "max": 1 },
          { "key": "pad_rand_decay_amt", "short": "RNDDC", "full": "Rnd Decay", "type": "float", "min": 0, "max": 1 },
          { "key": "pad_chance_pct",     "short": "CHNCE", "full": "Chance",    "type": "float", "min": 0, "max": 100 }
        ]
      ]
    },
    {
      "name": "Global",
      "rows": [
        [
          { "key": "g_master_vol",    "short": "MSVOL", "full": "Master Vol",  "type": "float", "min": 0, "max": 1 },
          { "key": "g_polyphony",     "short": "POLY",  "full": "Polyphony",   "type": "int",   "min": 1, "max": 16 },
          { "key": "g_vel_curve",     "short": "VELCV", "full": "Vel Curve",   "type": "enum",  "options": ["linear", "soft", "hard"] },
          { "key": "g_humanize_ms",   "short": "HUMAN", "full": "Humanize",    "type": "float", "min": 0, "max": 50 }
        ]
      ]
    }
  ]
}
```

- [ ] **Step 2: Create `src/modules/weird-dreams.json`**

```json
{
  "id": "weird-dreams",
  "name": "Weird Dreams",
  "drum": {
    "padCount": 8,
    "padNoteStart": 36,
    "rawMidi": false,
    "shiftSelectMidi": true
  },
  "banks": [
    {
      "name": "Voice",
      "padSpecific": true,
      "rows": [
        [
          { "key": "cv_vol",    "short": "VOL",   "full": "Volume",  "type": "float", "min": 0, "max": 1 },
          { "key": "cv_pan",    "short": "PAN",   "full": "Pan",     "type": "float", "min": -1, "max": 1 },
          { "key": "cv_freq",   "short": "FREQ",  "full": "Freq",    "type": "float", "min": 20, "max": 20000 },
          { "key": "cv_decay",  "short": "DECAY", "full": "Decay",   "type": "float", "min": 0, "max": 1 }
        ],
        [
          { "key": "cv_wave",   "short": "WAVE",  "full": "Wave",    "type": "float", "min": 0, "max": 1 },
          { "key": "cv_mix",    "short": "MIX",   "full": "Mix",     "type": "float", "min": 0, "max": 1 },
          { "key": "cv_cutoff", "short": "CUTOF", "full": "Cutoff",  "type": "float", "min": 0, "max": 1 },
          { "key": "cv_preset", "short": "PRSET", "full": "Preset",  "type": "int",   "min": 0, "max": 40 }
        ]
      ]
    },
    {
      "name": "Patch",
      "rows": [
        [
          { "key": "kit",       "short": "KIT",   "full": "Kit",       "type": "int",   "min": 0, "max": 63 },
          { "key": "rnd_kit",   "short": "RNKIT", "full": "Rnd Kit",   "type": "float", "min": 0, "max": 1 },
          { "key": "rnd_voice", "short": "RNDVC", "full": "Rnd Voice", "type": "float", "min": 0, "max": 1 },
          { "key": "rnd_pitch", "short": "RNDPT", "full": "Rnd Pitch", "type": "float", "min": 0, "max": 1 }
        ]
      ]
    },
    {
      "name": "FX",
      "rows": [
        [
          { "key": "rev_mix",   "short": "RVMIX", "full": "Rev Mix",   "type": "float", "min": 0, "max": 1 },
          { "key": "rev_type",  "short": "RVTYP", "full": "Rev Type",  "type": "int",   "min": 0, "max": 2 },
          { "key": "rev_size",  "short": "RVSIZ", "full": "Rev Size",  "type": "float", "min": 0, "max": 1 },
          { "key": "rev_decay", "short": "RVDCY", "full": "Rev Decay", "type": "float", "min": 0, "max": 1 }
        ],
        [
          { "key": "dly_mix",   "short": "DLMIX", "full": "Dly Mix",   "type": "float", "min": 0, "max": 1 },
          { "key": "dly_rate",  "short": "DLRAT", "full": "Dly Rate",  "type": "float", "min": 0, "max": 1 },
          { "key": "dly_fdbk",  "short": "DLFBK", "full": "Dly Fdbk", "type": "float", "min": 0, "max": 1 },
          { "key": "dly_tone",  "short": "DLTON", "full": "Dly Tone",  "type": "float", "min": 0, "max": 1 }
        ]
      ]
    }
  ]
}
```

- [ ] **Step 3: Create `src/modules/krautdrums.json`**

```json
{
  "id": "krautdrums",
  "name": "KrautDrums",
  "drum": {
    "padCount": 16,
    "padNoteStart": 68,
    "rawMidi": true
  },
  "banks": [
    {
      "name": "Levels",
      "rows": [
        [
          { "key": "lvl_bass",    "short": "BASS",  "full": "Bass",     "type": "float", "min": 0, "max": 1 },
          { "key": "lvl_conga",   "short": "CONGA", "full": "Conga",    "type": "float", "min": 0, "max": 1 },
          { "key": "lvl_tom1",    "short": "TOM1",  "full": "Tom 1",    "type": "float", "min": 0, "max": 1 },
          { "key": "lvl_tom2",    "short": "TOM2",  "full": "Tom 2",    "type": "float", "min": 0, "max": 1 },
          { "key": "lvl_claves",  "short": "CLVS",  "full": "Claves",   "type": "float", "min": 0, "max": 1 },
          { "key": "lvl_snare",   "short": "SNARE", "full": "Snare",    "type": "float", "min": 0, "max": 1 },
          { "key": "lvl_cowbell", "short": "COWBL", "full": "Cowbell",  "type": "float", "min": 0, "max": 1 },
          { "key": "lvl_cymbals", "short": "CYMBL", "full": "Cymbals",  "type": "float", "min": 0, "max": 1 }
        ]
      ]
    },
    {
      "name": "FX",
      "rows": [
        [
          { "key": "delay_mix",    "short": "DLMIX", "full": "Delay Mix",  "type": "float", "min": 0, "max": 1 },
          { "key": "delay_time",   "short": "DLTIM", "full": "Delay Time", "type": "float", "min": 0, "max": 1 },
          { "key": "delay_fb",     "short": "DLFBK", "full": "Delay Fdbk", "type": "float", "min": 0, "max": 1 },
          { "key": "reverb_mix",   "short": "RVMIX", "full": "Reverb Mix", "type": "float", "min": 0, "max": 1 },
          { "key": "reverb_decay", "short": "RVDCY", "full": "Reverb Dcy", "type": "float", "min": 0, "max": 1 },
          { "key": "reverb_tone",  "short": "RVTON", "full": "Reverb Tone","type": "float", "min": 0, "max": 1 },
          { "key": "bus_comp",     "short": "COMP",  "full": "Bus Comp",   "type": "float", "min": 0, "max": 1 },
          { "key": "all_decay",    "short": "ALDCY", "full": "All Decay",  "type": "float", "min": 0, "max": 1 }
        ]
      ]
    },
    {
      "name": "Attitude",
      "rows": [
        [
          { "key": "preamp_drive",  "short": "DRIVE", "full": "Drive",   "type": "float", "min": 0,    "max": 1 },
          { "key": "tape_amount",   "short": "TAPE",  "full": "Tape",    "type": "float", "min": 0,    "max": 1 },
          { "key": "hpf_freq",      "short": "HPF",   "full": "HPF",     "type": "float", "min": 30,   "max": 500 },
          { "key": "eq_body",       "short": "BODY",  "full": "Body",    "type": "float", "min": -6,   "max": 6 },
          { "key": "eq_air",        "short": "AIR",   "full": "Air",     "type": "float", "min": -6,   "max": 6 },
          { "key": "filter_cutoff", "short": "CUTOF", "full": "Cutoff",  "type": "float", "min": 100,  "max": 15000 },
          { "key": "filter_reso",   "short": "RESO",  "full": "Reso",    "type": "float", "min": 0,    "max": 1 },
          { "key": "phaser_amount", "short": "PHASE", "full": "Phaser",  "type": "float", "min": 0,    "max": 1 }
        ]
      ]
    },
    {
      "name": "General",
      "rows": [
        [
          { "key": "tempo",      "short": "TEMPO", "full": "Tempo",      "type": "float", "min": 60,  "max": 200 },
          { "key": "drift",      "short": "DRIFT", "full": "Drift",      "type": "float", "min": 0,   "max": 1 },
          { "key": "master_vol", "short": "MSVOL", "full": "Master Vol", "type": "float", "min": 0,   "max": 1 },
          { "key": "density",    "short": "DNSTY", "full": "Density",    "type": "float", "min": 0,   "max": 1 },
          null, null, null, null
        ]
      ]
    }
  ]
}
```

- [ ] **Step 4: Create `src/modules/libpo32.json`**

```json
{
  "id": "po32-drum",
  "name": "Libpo32",
  "drum": {
    "padCount": 8,
    "padNoteStart": 36,
    "rawMidi": false
  },
  "banks": [
    {
      "name": "Main",
      "rows": [
        [
          { "key": "kit",   "short": "KIT",   "full": "Kit",   "type": "int",   "min": 0, "max": 31 },
          { "key": "level", "short": "LEVEL", "full": "Level", "type": "float", "min": 0, "max": 1 },
          { "key": "decay", "short": "DECAY", "full": "Decay", "type": "float", "min": 0.1, "max": 3 },
          null
        ]
      ]
    }
  ]
}
```

- [ ] **Step 5: Create `src/modules/essaim.json`**

```json
{
  "id": "essaim",
  "name": "Essaim",
  "drum": {
    "padCount": 32,
    "padNoteStart": 68,
    "rawMidi": true
  },
  "banks": [
    {
      "name": "Global",
      "rows": [
        [
          { "key": "root_note",  "short": "ROOT",  "full": "Root Note",  "type": "int",   "min": 0,  "max": 127 },
          { "key": "scale",      "short": "SCALE", "full": "Scale",      "type": "int",   "min": 0,  "max": 95 },
          { "key": "rnd_patch",  "short": "RNDPT", "full": "Rnd Patch",  "type": "float", "min": 0,  "max": 1 },
          { "key": "same_freq",  "short": "SFREQ", "full": "Same Freq",  "type": "float", "min": 0,  "max": 1 },
          { "key": "init_freq",  "short": "IFREQ", "full": "Init Freq",  "type": "float", "min": 0,  "max": 1 },
          { "key": "same_speed", "short": "SPEED", "full": "Same Speed", "type": "float", "min": 0,  "max": 1 },
          { "key": "rnd_mod",    "short": "RNDMD", "full": "Rnd Mod",    "type": "float", "min": 0,  "max": 1 },
          { "key": "rnd_pan",    "short": "RNDPN", "full": "Rnd Pan",    "type": "float", "min": 0,  "max": 1 }
        ]
      ]
    },
    {
      "name": "FX",
      "rows": [
        [
          { "key": "transpose",    "short": "XPOSE", "full": "Transpose",  "type": "int",   "min": -24, "max": 24 },
          { "key": "fine",         "short": "FINE",  "full": "Fine",       "type": "float", "min": -1,  "max": 1 },
          { "key": "saturation",   "short": "SAT",   "full": "Saturation", "type": "float", "min": 0,   "max": 1 },
          { "key": "filter",       "short": "FILTR", "full": "Filter",     "type": "float", "min": 0,   "max": 1 },
          { "key": "dly_mix",      "short": "DLMIX", "full": "Dly Mix",    "type": "float", "min": 0,   "max": 1 },
          { "key": "dly_rate",     "short": "DLRAT", "full": "Dly Rate",   "type": "float", "min": 0,   "max": 1 },
          { "key": "dly_feedback", "short": "DLFBK", "full": "Dly Fdbk",  "type": "float", "min": 0,   "max": 1 },
          { "key": "dly_tone",     "short": "DLTON", "full": "Dly Tone",   "type": "float", "min": 0,   "max": 1 }
        ]
      ]
    },
    {
      "name": "Voice",
      "rows": [
        [
          { "key": "speed",     "short": "SPEED", "full": "Speed",     "type": "float", "min": 0, "max": 1 },
          { "key": "mod",       "short": "MOD",   "full": "Mod",       "type": "float", "min": 0, "max": 1 },
          { "key": "decay",     "short": "DECAY", "full": "Decay",     "type": "float", "min": 0, "max": 1 },
          { "key": "timbre",    "short": "TIMBR", "full": "Timbre",    "type": "float", "min": 0, "max": 1 },
          { "key": "frequency", "short": "FREQ",  "full": "Frequency", "type": "float", "min": 0, "max": 1 },
          { "key": "noisiness", "short": "NOISE", "full": "Noisiness", "type": "float", "min": 0, "max": 1 },
          { "key": "cutoff",    "short": "CUTOF", "full": "Cutoff",    "type": "float", "min": 0, "max": 1 },
          { "key": "volume",    "short": "VOL",   "full": "Volume",    "type": "float", "min": 0, "max": 1 }
        ]
      ]
    }
  ]
}
```

- [ ] **Step 6: Register all 5 in `src/modules/loader.ts`**

```typescript
import type { ModuleConfig } from '../types/param.js';
import plaitsJson     from './plaits.json';
import wurlJson       from './wurl.json';
import mrdrumsJson    from './mrdrums.json';
import weirdDreamsJson from './weird-dreams.json';
import krautdrumsJson from './krautdrums.json';
import libpo32Json    from './libpo32.json';
import essaimJson     from './essaim.json';

const MOVY_SG_ROOT = '/data/UserData/schwung/modules/sound_generators';

const CONFIGS: Record<string, ModuleConfig> = {
    plaits:        plaitsJson      as unknown as ModuleConfig,
    wurl:          wurlJson        as unknown as ModuleConfig,
    mrdrums:       mrdrumsJson     as unknown as ModuleConfig,
    'weird-dreams': weirdDreamsJson as unknown as ModuleConfig,
    krautdrums:    krautdrumsJson  as unknown as ModuleConfig,
    'po32-drum':   libpo32Json     as unknown as ModuleConfig,
    essaim:        essaimJson      as unknown as ModuleConfig,
};

function tryFile(path: string): ModuleConfig | null {
    if (typeof host_read_file !== 'function') return null;
    try {
        const s = host_read_file(path);
        if (s) return JSON.parse(s) as ModuleConfig;
    } catch {}
    return null;
}

export function loadModuleConfig(moduleId: string): ModuleConfig | null {
    if (!moduleId) return null;
    return tryFile(`${MOVY_SG_ROOT}/${moduleId}/movy_config.json`)
        ?? CONFIGS[moduleId]
        ?? null;
}
```

- [ ] **Step 7: Build and typecheck**

```bash
cd movy && npm run build && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
cd movy
git add src/modules/mrdrums.json src/modules/weird-dreams.json src/modules/krautdrums.json src/modules/libpo32.json src/modules/essaim.json src/modules/loader.ts
git commit -m "$(cat <<'EOF'
feat(drum): add bundled configs for 5 drum modules

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: loadHierarchy + Model Drum API

**Files:**
- Modify: `src/model/hierarchy.ts`
- Modify: `src/model/index.ts`
- Modify: `browser-test/logic.mjs`

- [ ] **Step 1: Write failing logic tests**

Add to `browser-test/logic.mjs`, after the existing test blocks:

```javascript
// ── Drum module detection ─────────────────────────────────────────────────

_log('\nTest: drum module detection via loadHierarchy');

{
  const mrdrumsPreset = {
    'synth:name': 'MrDrums',
    'synth_module': 'mrdrums',
    'synth:pad_vol': '0.8',
    'synth:ui_current_pad': '3',
  };

  const m = bootModel(mrdrumsPreset);
  const vm = m.getViewModel();
  eq('mrdrums: isDrum via drumPadCount', vm.drumPadCount, 16);
  eq('mrdrums: drumCurrentPad from param', vm.drumCurrentPad, 3);

  const krautPreset = {
    'synth:name': 'KrautDrums',
    'synth_module': 'krautdrums',
    'synth:lvl_bass': '0.85',
  };
  const mk = bootModel(krautPreset);
  const vmk = mk.getViewModel();
  eq('krautdrums: drumPadCount=16', vmk.drumPadCount, 16);
  eq('krautdrums: drumCurrentPad defaults to 1', vmk.drumCurrentPad, 1);

  const plaitsPreset = {
    'synth:name': 'Plaits',
    'synth_module': 'plaits',
  };
  const mp = bootModel(plaitsPreset);
  eq('plaits: not drum (drumPadCount=0)', mp.getViewModel().drumPadCount, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A2 "drum module"
```

Expected: FAIL — `vm.drumPadCount` is `undefined` or `0` for mrdrums.

- [ ] **Step 3: Update `src/model/hierarchy.ts` to populate drum state**

After the line `s.moduleConfig = loadModuleConfig(s.moduleId);` and before the custom bank path block, insert:

```typescript
/* ── Drum metadata ────────────────────────────────────────────────────────── */
s.isDrum             = false;
s.drumPadCount       = 0;
s.drumCurrentPad     = 1;
s.drumCurrentPhysPad = 0;
if (s.moduleConfig?.drum) {
    s.isDrum       = true;
    s.drumPadCount = s.moduleConfig.drum.padCount;
    if (s.moduleConfig.drum.currentPadParam) {
        const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + s.moduleConfig.drum.currentPadParam);
        if (raw) s.drumCurrentPad = Math.max(1, parseInt(raw));
    }
}
```

- [ ] **Step 4: Expose drum API on Model in `src/model/index.ts`**

Add two methods to the object returned by `createModel`:

```typescript
getDrumConfig(): import('../types/param.js').DrumConfig | null {
    return s.moduleConfig?.drum ?? null;
},

updateDrumPad(pad: number, physPad: number): void {
    s.drumCurrentPad     = pad;
    s.drumCurrentPhysPad = physPad;
    s.dirty = true;
},
```

Also update the `Model` type at the bottom (it's inferred, so no change needed there — TypeScript will pick up the new methods automatically).

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "(✓|✗|drum)"
```

Expected: all drum detection tests pass with ✓.

- [ ] **Step 6: Run full logic suite**

```bash
cd movy && node browser-test/logic.mjs
```

Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
cd movy
git add src/model/hierarchy.ts src/model/index.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(drum): populate drum state in loadHierarchy, expose getDrumConfig/updateDrumPad

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: buildViewModel Drum Fields

**Files:**
- Modify: `src/model/viewmodel.ts`
- Modify: `browser-test/logic.mjs`

- [ ] **Step 1: Write failing logic tests**

Append to `browser-test/logic.mjs`:

```javascript
_log('\nTest: ViewModel drum fields');

{
  const mrdrumsPreset = {
    'synth:name': 'MrDrums',
    'synth_module': 'mrdrums',
    'synth:ui_current_pad': '5',
    'synth:pad_vol': '0.8',
  };
  const m = bootModel(mrdrumsPreset);

  // First bank (Main) is padSpecific
  const vm0 = m.getViewModel();
  eq('mrdrums bank 0 isPadSpecific', vm0.isPadSpecific, true);
  eq('mrdrums drumCurrentPad', vm0.drumCurrentPad, 5);
  eq('mrdrums drumPadCount', vm0.drumPadCount, 16);

  // Navigate to Global bank (index 2) — not padSpecific
  m.changePage(1); // → Rand (padSpecific)
  m.changePage(1); // → Global (not padSpecific)
  const vm2 = m.getViewModel();
  eq('mrdrums Global bank isPadSpecific=false', vm2.isPadSpecific, false);

  // Non-drum module
  const plaitsPreset = { 'synth:name': 'Plaits', 'synth_module': 'plaits' };
  const mp = bootModel(plaitsPreset);
  eq('plaits isPadSpecific=false', mp.getViewModel().isPadSpecific, false);
  eq('plaits drumPadCount=0', mp.getViewModel().drumPadCount, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A3 "ViewModel drum"
```

Expected: FAIL — `isPadSpecific` is `undefined`.

- [ ] **Step 3: Update `src/model/viewmodel.ts`**

In `buildViewModel`, add after the `bankName` resolution block:

```typescript
const currentBank    = s.moduleConfig?.banks?.[s.knobPage] ?? null;
const isPadSpecific  = currentBank?.padSpecific ?? false;
```

In the return statement, add the three drum fields:

```typescript
return {
    moduleName:     s.activeModuleName,
    bankName,
    bankIndex:      s.knobPage,
    bankCount:      nBanks,
    rows,
    touchedSlot:    primary >= 0 ? primary : null,
    toast,
    overlay:        s.enumOverlay
        ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
        : s.fileOverlay
        ? { slot: s.fileOverlay.slot, options: s.fileOverlay.items.map(p => basename(p).slice(0, 12)), selected: s.fileOverlay.selected }
        : null,
    isEmpty:        s.moduleId === '' && s.activeModuleName === '—',
    drumPadCount:   s.drumPadCount,
    drumCurrentPad: s.drumCurrentPad,
    isPadSpecific,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
cd movy
git add src/model/viewmodel.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(drum): expose drumPadCount, drumCurrentPad, isPadSpecific in ViewModel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Drum MIDI Handler

**Files:**
- Create: `src/keyboard/drum-handler.ts`
- Modify: `browser-test/logic.mjs`

- [ ] **Step 1: Write failing logic tests**

Append to `browser-test/logic.mjs`:

```javascript
import { drumPadOn, drumPadOff } from '../dist/esm/keyboard/drum-handler.js';

_log('\nTest: drumPadOn');

{
  let sentMidi = [];
  let setParams = {};
  const origSendMidi  = globalThis.shadow_send_midi_to_dsp;
  const origSetParam  = globalThis.shadow_set_param;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  globalThis.shadow_set_param = (_s, key, val) => { setParams[key] = val; return true; };

  const mrdCfg = { padCount: 16, padNoteStart: 36, rawMidi: false, currentPadParam: 'ui_current_pad' };

  // pad 68, rawMidi=false, rootNote=36: PAD_MAP[0]=0 → midiNote=36 → drumPad=1
  sentMidi = []; setParams = {};
  const r1 = drumPadOn(68, 68, false, mrdCfg, 36, 'synth', 0);
  eq('mrdrums pad68 → drumPad 1', r1, 1);
  eq('sends NoteOn 36', sentMidi[0]?.[1], 36);
  eq('velocity 100', sentMidi[0]?.[2], 100);
  eq('sets ui_current_pad=1', setParams['synth:ui_current_pad'], '1');

  // pad 76, PAD_MAP[8]=1 → midiNote=37 → drumPad=2
  sentMidi = []; setParams = {};
  const r2 = drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 0);
  eq('mrdrums pad76 → drumPad 2', r2, 2);
  eq('sends NoteOn 37', sentMidi[0]?.[1], 37);

  // shift+pad (no shiftSelectMidi) → suppresses MIDI, still sets param
  sentMidi = []; setParams = {};
  const r3 = drumPadOn(68, 68, true, mrdCfg, 36, 'synth', 0);
  eq('shift+pad returns drumPad 1', r3, 1);
  eq('shift: no MIDI sent', sentMidi.length, 0);
  eq('shift: still sets param', setParams['synth:ui_current_pad'], '1');

  // shiftSelectMidi=true (weird-dreams) → sends vel=1
  const wdCfg = { padCount: 8, padNoteStart: 36, rawMidi: false, shiftSelectMidi: true };
  sentMidi = [];
  drumPadOn(68, 68, true, wdCfg, 36, 'synth', 0);
  eq('shiftSelectMidi: sends vel=1', sentMidi[0]?.[2], 1);

  // rawMidi=true (krautdrums): midiNote=physPad → drumPad=physPad-padNoteStart+1
  const kCfg = { padCount: 16, padNoteStart: 68, rawMidi: true };
  sentMidi = []; setParams = {};
  const r4 = drumPadOn(68, 68, false, kCfg, 36, 'synth', 0);
  eq('krautdrums pad68 → drumPad 1', r4, 1);
  eq('rawMidi sends pad note 68', sentMidi[0]?.[1], 68);

  // out-of-range pad → null
  const r5 = drumPadOn(99, 68, false, mrdCfg, 36, 'synth', 0);
  eq('out-of-range → null', r5, null);

  globalThis.shadow_send_midi_to_dsp = origSendMidi;
  globalThis.shadow_set_param = origSetParam;
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A3 "drumPadOn"
```

Expected: FAIL — `drumPadOn` is not a function.

- [ ] **Step 3: Create `src/keyboard/drum-handler.ts`**

```typescript
import type { DrumConfig } from '../types/param.js';
import { PAD_MAP } from './notes.js';

export function drumPadOn(
    physPad:      number,
    padMin:       number,
    shiftHeld:    boolean,
    drumConfig:   DrumConfig,
    rootNote:     number,
    componentKey: string,
    slot:         number,
): number | null {
    let midiNote: number;
    if (drumConfig.rawMidi) {
        midiNote = physPad;
    } else {
        const offset = PAD_MAP[physPad - padMin];
        if (offset === null || offset === undefined) return null;
        midiNote = rootNote + offset;
    }
    const drumPad = midiNote - drumConfig.padNoteStart + 1;
    if (drumPad < 1 || drumPad > drumConfig.padCount) return null;

    const suppressMidi = shiftHeld && !drumConfig.shiftSelectMidi;
    if (!suppressMidi) {
        shadow_send_midi_to_dsp([MidiNoteOn, midiNote, shiftHeld ? 1 : 100]);
    }
    if (drumConfig.currentPadParam) {
        shadow_set_param(slot, componentKey + ':' + drumConfig.currentPadParam, String(drumPad));
    }
    return drumPad;
}

export function drumPadOff(
    physPad:    number,
    padMin:     number,
    drumConfig: DrumConfig,
    rootNote:   number,
): void {
    let midiNote: number;
    if (drumConfig.rawMidi) {
        midiNote = physPad;
    } else {
        const offset = PAD_MAP[physPad - padMin];
        if (offset === null || offset === undefined) return;
        midiNote = rootNote + offset;
    }
    const drumPad = midiNote - drumConfig.padNoteStart + 1;
    if (drumPad < 1 || drumPad > drumConfig.padCount) return;
    shadow_send_midi_to_dsp([MidiNoteOff, midiNote, 0]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
cd movy
git add src/keyboard/drum-handler.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(drum): add drumPadOn/drumPadOff with shift-suppress and rawMidi support

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Router Dispatch

**Files:**
- Modify: `src/midi/router.ts`

- [ ] **Step 1: Update the pad-notes block in `src/midi/router.ts`**

Add the import at the top of the file:
```typescript
import { drumPadOn, drumPadOff } from '../keyboard/drum-handler.js';
```

Replace the pad notes block (currently lines 50–55):

```typescript
/* Pad notes */
if (d1 >= PAD_MIN && d1 <= PAD_MAX) {
    const model    = activeModel();
    const drumCfg  = model?.getDrumConfig() ?? null;
    if ((status & 0xF0) === 0x90 && d2 > 0) {
        if (drumCfg) {
            const pad = drumPadOn(d1, PAD_MIN, appState.shiftHeld, drumCfg, keyboardState.rootNote, model!.getComponentKey(), appState.activeSlot);
            if (pad !== null) model!.updateDrumPad(pad, d1);
        } else {
            noteOn(d1, PAD_MIN, PAD_MAX);
        }
        return;
    }
    if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
        if (drumCfg) {
            drumPadOff(d1, PAD_MIN, drumCfg, keyboardState.rootNote);
        } else {
            noteOff(d1, PAD_MIN);
        }
        return;
    }
}
```

- [ ] **Step 2: Build and typecheck**

```bash
cd movy && npm run build && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run full logic suite**

```bash
cd movy && node browser-test/logic.mjs
```

Expected: 0 failures.

- [ ] **Step 4: Commit**

```bash
cd movy
git add src/midi/router.ts
git commit -m "$(cat <<'EOF'
feat(drum): route physical pad hits to drum handler when isDrum

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Pad Grid Icon + knob-view

**Files:**
- Modify: `src/renderer/header.ts`
- Modify: `src/renderer/knob-view.ts`
- Modify: `browser-test/screenshot.mjs` (add drum scenario, update baselines)

- [ ] **Step 1: Add `drawPadGridIcon` to `src/renderer/header.ts`**

Append to the file:

```typescript
/**
 * Renders a bordered mini pad-grid icon.
 * 16-pad: 6×6px (4×4 inner). 8-pad: 6×4px (4×2 inner).
 * Active pad cell (1-indexed) is filled; others are empty inside the border.
 */
export function drawPadGridIcon(x: number, y: number, padCount: number, currentPad: number): void {
    const rows = padCount <= 8 ? 2 : 4;
    const w    = 6;
    const h    = rows + 2;
    // border
    fill_rect(x,         y,         w, 1, 1);
    fill_rect(x,         y + h - 1, w, 1, 1);
    fill_rect(x,         y,         1, h, 1);
    fill_rect(x + w - 1, y,         1, h, 1);
    // active cell
    if (currentPad >= 1 && currentPad <= padCount) {
        const row = Math.floor((currentPad - 1) / 4);
        const col = (currentPad - 1) % 4;
        fill_rect(x + 1 + col, y + 1 + row, 1, 1, 1);
    }
}
```

- [ ] **Step 2: Update `src/renderer/knob-view.ts` to render the icon**

Add the import at the top:
```typescript
import { drawHeader, drawBankBar, drawPadGridIcon } from './header.js';
```

Replace the header-drawing block in `renderKnobsView` (the `if (vm.toast)` ... `drawHeader(dispName, vm.bankName || null, false)` section) with:

```typescript
if (vm.toast) {
    drawHeader(vm.toast.fullName, vm.overlay ? null : vm.toast.value, true);
} else {
    const trackLabel = 'T' + (activeSlot + 1);
    const showIcon   = vm.isPadSpecific && vm.drumPadCount > 0;
    const iconW      = showIcon ? 7 : 0;  // 6px icon + 1px gap
    const rightW     = vm.bankName ? fontWidth(vm.bankName) + 4 + iconW : 0;
    const maxLeftW   = W - rightW - 4;
    let dispName     = trackLabel + ' > ' + vm.moduleName;
    while (dispName.length > 1 && fontWidth(dispName) > maxLeftW) {
        dispName = dispName.slice(0, -1);
    }
    if (showIcon && vm.bankName) {
        drawHeader(dispName, null, false);
        const bankNameW = fontWidth(vm.bankName);
        const iconX     = W - 2 - bankNameW - 1 - 6;
        drawPadGridIcon(iconX, 0, vm.drumPadCount, vm.drumCurrentPad);
        fontPrint(W - 2 - bankNameW, 1, vm.bankName, 1);
    } else {
        drawHeader(dispName, vm.bankName || null, false);
    }
}
```

- [ ] **Step 3: Build and typecheck**

```bash
cd movy && npm run build && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Add drum screenshot scenario and update baselines**

In `browser-test/screenshot.mjs`, add a drum module scenario. Find where other scenarios are defined and add:

```javascript
// Drum module — padSpecific bank with icon (pad 5 active)
{
  label: 'drum-mrdrums-pad5',
  setup() {
    mockState = {
      'synth:name': 'MrDrums',
      'synth_module': 'mrdrums',
      'synth:ui_current_pad': '5',
      'synth:pad_vol':    '0.80',
      'synth:pad_pan':    '0.00',
      'synth:pad_tune':   '0.00',
      'synth:pad_start':  '0.00',
      'synth:pad_attack_ms': '0.00',
      'synth:pad_decay_ms':  '250.0',
      'synth:pad_mode':   '0',
    };
  },
  render(m) {
    const vm = m.getViewModel();
    renderKnobsView(vm, false, 0);
  },
},
// Drum module — non-padSpecific bank (Global), no icon
{
  label: 'drum-mrdrums-global',
  setup() {
    mockState = {
      'synth:name': 'MrDrums',
      'synth_module': 'mrdrums',
      'synth:ui_current_pad': '1',
      'synth:g_master_vol': '1.0',
      'synth:g_polyphony': '16',
    };
  },
  render(m) {
    m.changePage(1); m.changePage(1); // navigate to Global (bank 2)
    const vm = m.getViewModel();
    renderKnobsView(vm, false, 0);
  },
},
```

Update baselines:

```bash
cd movy && node browser-test/screenshot.mjs --update
```

Expected: new baseline PNGs created for `drum-mrdrums-pad5` and `drum-mrdrums-global`. Verify them visually — `drum-mrdrums-pad5` must show a 6×6 bordered icon to the left of "Main" in the header with the 5th cell (row 1, col 0) filled.

- [ ] **Step 5: Run full test suite**

```bash
cd movy
node browser-test/logic.mjs
node browser-test/screenshot.mjs
node browser-test/perf.mjs
```

Expected: 0 failures across all three.

- [ ] **Step 6: Commit**

```bash
cd movy
git add src/renderer/header.ts src/renderer/knob-view.ts browser-test/screenshot.mjs browser-test/screenshots/
git commit -m "$(cat <<'EOF'
feat(drum): render pad grid icon left of bank name for padSpecific pages

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Device Test + Final Push

- [ ] **Step 1: Check device reachability and run device tests**

```bash
cd movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

If OFFLINE: report to user in CAPS.

- [ ] **Step 2: Push**

```bash
cd movy && git push
```
