# Transport/Beat-Clock Service Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schwung's synced-mode LFOs phase-lock, drift-free, to whichever transport is playing (movy sequencer or Move native), via a new shim-level transport service; movy emits MIDI clock from its sequencer engine.

**Architecture:** A new `shadow_transport.{c,h}` unit in the schwung shim is the single clock authority — fed 0xF8/0xFA/0xFB/0xFC from the existing cable-0 tap (Move native) and from a new realtime interception in `overtake_midi_send_internal` (movy). It arbitrates (Move wins while running), counts 24-PPQN ticks, EMA-measures tempo, and exposes an interpolated `get_beat_position()` through the host API. Both LFO tick sites use it when a transport runs; otherwise they free-run exactly as today. Movy's Rust engine pushes `Start/Clock/Stop` OutEvents from its 96-PPQN clock (÷4).

**Tech Stack:** C (schwung shim/chain, C11), Rust (movy seq-core/movy-dsp), bash test harnesses, Docker cross-compile for device deploys.

**Spec:** `movy/plans/2026-07-12-transport-beat-clock-design.md` (approved). Read it first — especially §3 (architecture), §5b (perf guardrails), §6 (risks).

## Global Constraints

- **Schwung work happens ONLY in a fresh worktree branched from `origin/main`** (Task 0). The existing `/Users/dake/git/cld/schwung` checkout is a diverged reference — never commit there. `schwung-davebox` is reference-only.
- **RT safety (schwung):** everything called from the SPI/audio path (`shadow_transport_*`, LFO ticks, `overtake_midi_send_internal`) must be branch+arithmetic only — no logging, no I/O, no allocation, no locks (see schwung `docs/REALTIME_SAFETY.md`).
- **Realtime MIDI must never go through `shadow_chain_dispatch_midi_to_slots`** — per-slot channel remap rewrites `0xF8` → `0xF0|ch` for slots with a forward channel.
- **Movy:** `ENGINE_VERSION` must match between `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` (build fails otherwise). Never scp over a dlopen'd `dsp.so` (deploy.sh handles it). Run the full movy local suite (`npm test` + `cargo test`) at the end of every movy task.
- **Device:** check reachability with `ssh -o ConnectTimeout=3 ableton@move.local echo ok` before device steps; if offline, report `DEVICE OFFLINE` in CAPS and stop at the device task (everything before it is still committable).
- Comments explain WHY, never WHAT. No code duplication — shared logic goes in one place.
- Commit after every task. Movy commits push to `main`; schwung commits go to the feature branch (push only; PR creation is a user decision at the end).
- Plan verified against schwung `origin/main` @ `bde822df` (2026-07-12). If files moved since, `git log --follow` to find them; the design doc §8 has function-level pointers.

---

### Task 0: Schwung worktree setup

**Files:** none (git only)

- [ ] **Step 1: Create worktree from origin/main**

```bash
cd /Users/dake/git/cld/schwung
git fetch origin
git worktree add ../schwung-transport -b feat/transport-beat-clock origin/main
cd ../schwung-transport
git log -1 --format='%h %s'   # expect bde822df or newer origin/main tip
```

- [ ] **Step 2: Sanity-check the seams this plan patches exist**

```bash
grep -n "sampler_on_clock(status_usb)" src/schwung_shim.c          # cable-0 tap (~1201)
grep -n "static int overtake_midi_send_internal" src/schwung_shim.c # (~1325)
grep -n "static void shadow_inprocess_render_to_buffer" src/schwung_shim.c # (~1582)
grep -n "overtake_host_api.get_bpm" src/schwung_shim.c              # (~1458)
grep -n "get_bpm = shim_get_bpm" src/schwung_shim.c                 # cm_host init (~3866)
grep -n "shadow_host_api.get_bpm" src/host/shadow_chain_mgmt.c      # (~994)
grep -n "lfo_sync_rate_hz" src/host/lfo_common.h                    # (~201)
grep -n "static void lfo_tick" src/modules/chain/dsp/chain_host.c
grep -n "void shadow_master_fx_lfo_tick" src/host/shadow_chain_mgmt.c
grep -n "float sampler_get_bpm" src/host/shadow_sampler.c           # (~332)
```

Expected: every grep hits. If any misses, stop and locate the moved code before proceeding.

---

### Task 1: `shadow_transport` unit (TDD)

**Files:**
- Create: `src/host/shadow_transport.h`
- Create: `src/host/shadow_transport.c`
- Create: `tests/host/test_shadow_transport.c`
- Create: `tests/host/test_shadow_transport.sh`

**Interfaces (Produces — later tasks call these exact signatures):**

```c
typedef enum {
    TRANSPORT_SRC_NONE = 0,
    TRANSPORT_SRC_MOVE = 1,      /* Move's native sequencer (cable-0 realtime) */
    TRANSPORT_SRC_INTERNAL = 2,  /* overtake DSP (movy) via midi_send_internal */
} transport_src_t;

void   shadow_transport_init(uint32_t sample_rate);
void   shadow_transport_on_realtime(transport_src_t src, uint8_t status);
void   shadow_transport_advance_block(int frames);   /* once per audio block */
double shadow_transport_beat_position(void);         /* beats; < 0 = no transport */
float  shadow_transport_bpm(void);                   /* 0 = unknown */
int    shadow_transport_source(void);                /* active transport_src_t */
```

- [ ] **Step 1: Write the failing test**

`tests/host/test_shadow_transport.c`:

```c
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "host/shadow_transport.h"

static void fail(const char *msg) { fprintf(stderr, "FAIL: %s\n", msg); exit(1); }
static void expect_near(double got, double want, double tol, const char *msg) {
    if (fabs(got - want) > tol) {
        fprintf(stderr, "FAIL: %s (got %f want %f)\n", msg, got, want);
        exit(1);
    }
}

/* 125 BPM at 24 PPQN and 44100 Hz = exactly 882 samples per tick. */
#define TICK_SAMPLES 882

/* Advance in 128-frame blocks, firing a tick each time the boundary passes. */
static void run_ticks(transport_src_t src, int ticks) {
    static long long carry = 0;
    for (int t = 0; t < ticks; t++) {
        carry += TICK_SAMPLES;
        while (carry > 0) { shadow_transport_advance_block(128); carry -= 128; }
        shadow_transport_on_realtime(src, 0xF8);
    }
}

int main(void) {
    /* --- start anchor: FA then first F8 = beat 0 --- */
    shadow_transport_init(44100);
    shadow_transport_on_realtime(TRANSPORT_SRC_INTERNAL, 0xFA);
    shadow_transport_on_realtime(TRANSPORT_SRC_INTERNAL, 0xF8);
    expect_near(shadow_transport_beat_position(), 0.0, 1e-9, "beat 0 at first tick");
    if (shadow_transport_source() != TRANSPORT_SRC_INTERNAL) fail("internal source active");

    /* --- 24 ticks later = beat 1; measured bpm = 125 --- */
    run_ticks(TRANSPORT_SRC_INTERNAL, 24);
    expect_near(shadow_transport_beat_position(), 1.0, 0.02, "beat 1 after 24 ticks");
    expect_near((double)shadow_transport_bpm(), 125.0, 0.5, "bpm measured 125");

    /* --- interpolation: half a tick of silence advances ~half a tick --- */
    double before = shadow_transport_beat_position();
    shadow_transport_advance_block(TICK_SAMPLES / 2);
    double mid = shadow_transport_beat_position();
    expect_near(mid - before, 0.5 / 24.0, 0.01, "interpolated half tick");

    /* --- interpolation clamps: a very late tick never overshoots --- */
    shadow_transport_advance_block(TICK_SAMPLES * 3);
    double late = shadow_transport_beat_position();
    if (late > before + 1.5 / 24.0) fail("interpolation must clamp at one tick");

    /* --- arbitration: Move start takes over; Move stop hands back --- */
    shadow_transport_init(44100);
    shadow_transport_on_realtime(TRANSPORT_SRC_INTERNAL, 0xFA);
    shadow_transport_on_realtime(TRANSPORT_SRC_INTERNAL, 0xF8);
    shadow_transport_on_realtime(TRANSPORT_SRC_MOVE, 0xFA);
    shadow_transport_on_realtime(TRANSPORT_SRC_MOVE, 0xF8);
    if (shadow_transport_source() != TRANSPORT_SRC_MOVE) fail("Move wins while running");
    shadow_transport_on_realtime(TRANSPORT_SRC_MOVE, 0xFC);
    if (shadow_transport_source() != TRANSPORT_SRC_INTERNAL) fail("falls back to internal");

    /* --- stop: no transport = negative beat position --- */
    shadow_transport_on_realtime(TRANSPORT_SRC_INTERNAL, 0xFC);
    if (shadow_transport_beat_position() >= 0.0) fail("stopped = beat < 0");
    if (shadow_transport_source() != TRANSPORT_SRC_NONE) fail("stopped = no source");

    /* --- staleness: ticks stop arriving -> transport flips off --- */
    shadow_transport_init(44100);
    shadow_transport_on_realtime(TRANSPORT_SRC_INTERNAL, 0xFA);
    run_ticks(TRANSPORT_SRC_INTERNAL, 4);
    shadow_transport_advance_block(44100);  /* 1 s of silence > 0.5 s staleness */
    if (shadow_transport_beat_position() >= 0.0) fail("stale clock = beat < 0");

    /* --- unanchored clock (tool opened mid-song): F8 without FA still runs --- */
    shadow_transport_init(44100);
    run_ticks(TRANSPORT_SRC_MOVE, 26);
    if (shadow_transport_beat_position() < 0.0) fail("bare clock runs unanchored");
    expect_near((double)shadow_transport_bpm(), 125.0, 0.5, "bpm from bare clock");

    printf("PASS: test_shadow_transport\n");
    return 0;
}
```

`tests/host/test_shadow_transport.sh` (mirror `tests/host/test_arp_clock_status.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
bin="build/tests/test_shadow_transport"
mkdir -p "$(dirname "$bin")"
cc -std=c11 -Wall -Wextra -Werror -Isrc \
  tests/host/test_shadow_transport.c \
  src/host/shadow_transport.c \
  -lm -o "$bin"
"$bin"
```

Also write `src/host/shadow_transport.h` now (exact content = the Interfaces block above, wrapped in `#ifndef SHADOW_TRANSPORT_H` guards, `#include <stdint.h>`, and a header comment: single transport authority, audio-thread-only, no locks/I/O).

- [ ] **Step 2: Run test to verify it fails**

```bash
chmod +x tests/host/test_shadow_transport.sh && bash tests/host/test_shadow_transport.sh
```

Expected: compile FAIL (`shadow_transport.c: No such file`).

- [ ] **Step 3: Implement `src/host/shadow_transport.c`**

```c
/* Single authority for transport state: which clock source is running, its
 * tempo, and an interpolated beat position. Fed system-realtime bytes from
 * the shim's cable-0 tap (Move native) and from overtake-DSP internal sends.
 * Every function runs on the shim's audio thread: fixed-size state, no
 * locks, no I/O, no allocation. */
#include "shadow_transport.h"

#define TRANSPORT_PPQN 24
#define TRANSPORT_STALE_SEC 0.5
/* EMA weight: converges in ~10 ticks while absorbing the ±1-block (~2.9 ms)
 * jitter of block-quantized clock senders. */
#define TRANSPORT_EMA_ALPHA 0.25

typedef struct {
    int running;
    int awaiting_first_tick;  /* set by 0xFA; the next 0xF8 is tick 0 */
    unsigned long long tick_count;
    unsigned long long last_tick_at;  /* sample time of last 0xF8 */
    double tick_interval;             /* EMA, samples per tick; 0 = unknown */
} transport_source_state_t;

static transport_source_state_t g_src[3];
static unsigned long long g_now;
static uint32_t g_sample_rate = 44100;
static unsigned long long g_stale_samples;

void shadow_transport_init(uint32_t sample_rate) {
    for (int i = 0; i < 3; i++) {
        g_src[i].running = 0;
        g_src[i].awaiting_first_tick = 0;
        g_src[i].tick_count = 0;
        g_src[i].last_tick_at = 0;
        g_src[i].tick_interval = 0.0;
    }
    g_now = 0;
    g_sample_rate = sample_rate ? sample_rate : 44100;
    g_stale_samples = (unsigned long long)(TRANSPORT_STALE_SEC * g_sample_rate);
}

void shadow_transport_advance_block(int frames) {
    if (frames > 0) g_now += (unsigned long long)frames;
    /* Staleness safety net: Move normally sends 0xFC on stop, but a wedged
     * sender must not leave LFOs frozen on a dead beat position. */
    for (int i = 1; i < 3; i++) {
        if (g_src[i].running && g_src[i].last_tick_at &&
            g_now - g_src[i].last_tick_at > g_stale_samples) {
            g_src[i].running = 0;
        }
    }
}

void shadow_transport_on_realtime(transport_src_t src, uint8_t status) {
    if (src != TRANSPORT_SRC_MOVE && src != TRANSPORT_SRC_INTERNAL) return;
    transport_source_state_t *s = &g_src[src];
    switch (status) {
    case 0xFA:
        s->running = 1;
        s->awaiting_first_tick = 1;
        s->tick_count = 0;
        s->last_tick_at = g_now;
        break;
    case 0xFB:
        s->running = 1;
        break;
    case 0xFC:
        s->running = 0;
        break;
    case 0xF8:
        if (!s->running) {
            /* Clock without Start (we attached mid-song): run unanchored so
             * the tempo is right; bar alignment arrives with the next 0xFA. */
            s->running = 1;
            s->awaiting_first_tick = 1;
        }
        if (s->awaiting_first_tick) {
            s->awaiting_first_tick = 0;
            s->tick_count = 0;
        } else {
            s->tick_count++;
            double delta = (double)(g_now - s->last_tick_at);
            /* Accept only intervals inside 20–999 BPM at 24 PPQN. */
            double min_d = (60.0 * g_sample_rate) / (999.0 * TRANSPORT_PPQN);
            double max_d = (60.0 * g_sample_rate) / (20.0 * TRANSPORT_PPQN);
            if (delta >= min_d && delta <= max_d) {
                s->tick_interval = (s->tick_interval <= 0.0)
                    ? delta
                    : s->tick_interval + TRANSPORT_EMA_ALPHA * (delta - s->tick_interval);
            }
        }
        s->last_tick_at = g_now;
        break;
    default:
        break;
    }
}

static transport_source_state_t *transport_active(int *which) {
    if (g_src[TRANSPORT_SRC_MOVE].running) {
        if (which) *which = TRANSPORT_SRC_MOVE;
        return &g_src[TRANSPORT_SRC_MOVE];
    }
    if (g_src[TRANSPORT_SRC_INTERNAL].running) {
        if (which) *which = TRANSPORT_SRC_INTERNAL;
        return &g_src[TRANSPORT_SRC_INTERNAL];
    }
    if (which) *which = TRANSPORT_SRC_NONE;
    return 0;
}

double shadow_transport_beat_position(void) {
    transport_source_state_t *s = transport_active(0);
    if (!s) return -1.0;
    double frac = 0.0;
    if (s->tick_interval > 0.0) {
        frac = (double)(g_now - s->last_tick_at) / s->tick_interval;
        /* Never run past the next expected tick: a late tick freezes phase
         * instead of overshooting and snapping back. */
        if (frac > 1.0) frac = 1.0;
        if (frac < 0.0) frac = 0.0;
    }
    return ((double)s->tick_count + frac) / (double)TRANSPORT_PPQN;
}

float shadow_transport_bpm(void) {
    transport_source_state_t *s = transport_active(0);
    if (!s || s->tick_interval <= 0.0) return 0.0f;
    return (float)((60.0 * g_sample_rate) / (s->tick_interval * TRANSPORT_PPQN));
}

int shadow_transport_source(void) {
    int which = TRANSPORT_SRC_NONE;
    (void)transport_active(&which);
    return which;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bash tests/host/test_shadow_transport.sh
```

Expected: `PASS: test_shadow_transport`.

- [ ] **Step 5: Commit**

```bash
git add src/host/shadow_transport.h src/host/shadow_transport.c \
        tests/host/test_shadow_transport.c tests/host/test_shadow_transport.sh
git commit -m "feat(shim): transport/beat-clock service — tick-counted, interpolated beat position with source arbitration"
```

---

### Task 2: Wire the transport service into the shim

**Files:**
- Modify: `src/schwung_shim.c` (cable-0 tap ~1201; `overtake_midi_send_internal` ~1325; `shadow_inprocess_render_to_buffer` ~1582; init near `chain_mgmt_init` ~3855)
- Modify: `src/host/shadow_midi.c` + `src/host/shadow_midi.h` (new broadcast helper)
- Modify: `scripts/build.sh` (shim source list, ~line 238 block, and the gcc link line below it)

**Interfaces:**
- Consumes: Task 1's `shadow_transport_*` functions.
- Produces: `void shadow_chain_broadcast_realtime(uint8_t status);` in `shadow_midi.h`.

- [ ] **Step 1: Add the realtime broadcast helper to `shadow_midi.c`**

Next to `shadow_chain_dispatch_midi_to_slots` (it uses the same externs, which already resolve in the shim build — `overtake_midi_send_internal` calls the dispatch today):

```c
/* Broadcast a 1-byte system-realtime message to every active chain slot.
 * Realtime must NOT go through shadow_chain_dispatch_midi_to_slots: the
 * per-slot channel remap rewrites the status low nibble (0xF8 -> 0xF0|ch)
 * for slots with a forward channel. Mirrors the shim's cable-0 realtime
 * broadcast, for internally generated transport. */
void shadow_chain_broadcast_realtime(uint8_t status)
{
    const plugin_api_v2_t *pv2 = *host_plugin_v2;
    if (!pv2 || !pv2->on_midi) return;
    uint8_t msg[1] = { status };
    for (int i = 0; i < SHADOW_CHAIN_INSTANCES; i++) {
        if (host_chain_slots[i].active && host_chain_slots[i].instance)
            pv2->on_midi(host_chain_slots[i].instance, msg, 1,
                         MOVE_MIDI_SOURCE_EXTERNAL);
    }
}
```

Declare it in `shadow_midi.h` beside the dispatch declaration. (Leave the shim's existing cable-0 slot-broadcast loop untouched — it's a proven path; dedup is not worth the risk here.)

- [ ] **Step 2: Feed and advance the service in `schwung_shim.c`**

Add `#include "host/shadow_transport.h"` next to the other `host/` includes (match the exact include style used for `shadow_sampler.h` in this file).

(a) Cable-0 tap — inside the `cin == 0x0F` realtime branch, extend the existing cable-0 block:

```c
if (cable == 0) {
    sampler_on_clock(status_usb);
    shadow_transport_on_realtime(TRANSPORT_SRC_MOVE, status_usb);
}
```

(b) Internal realtime — top of `overtake_midi_send_internal`, after the `len < 4` guard:

```c
/* System realtime is transport, not note data: feed the transport service
 * and broadcast on the same path as the cable-0 tap. */
if (msg[1] >= 0xF8) {
    shadow_transport_on_realtime(TRANSPORT_SRC_INTERNAL, msg[1]);
    shadow_chain_broadcast_realtime(msg[1]);
    return len;
}
```

(c) Per-block advance — first line of `shadow_inprocess_render_to_buffer()` so slot LFOs (which render later in this function) read a fresh position:

```c
shadow_transport_advance_block(MOVE_FRAMES_PER_BLOCK);
```

(d) Init — next to the `chain_mgmt_init(&cm_host)` block:

```c
/* Move's audio path is fixed 44.1 kHz (see shadow_master_fx_lfo_tick). */
shadow_transport_init(44100);
```

- [ ] **Step 3: Add to the build**

In `scripts/build.sh`: add `src/host/shadow_transport.c` and `src/host/shadow_transport.h` to the shim `needs_rebuild` dependency list (the block listing `src/host/shadow_sampler.c ...`) AND `src/host/shadow_transport.c` to the `${CROSS_PREFIX}gcc ... build/schwung-shim.so` compile line below it.

- [ ] **Step 4: Compile-check without Docker**

```bash
cc -std=c11 -fsyntax-only -Isrc src/host/shadow_transport.c && echo OK
bash tests/host/test_shadow_transport.sh
```

Expected: `OK`, then `PASS`. (Full shim cross-compile happens in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/schwung_shim.c src/host/shadow_midi.c src/host/shadow_midi.h scripts/build.sh
git commit -m "feat(shim): feed transport service from cable-0 and internal realtime; broadcast internal realtime to slots without channel remap"
```

---

### Task 3: `get_beat_position` host API + tempo delegation

**Files:**
- Modify: `src/host/plugin_api_v1.h` (host_api_v1_t, after `get_bpm` block ~87 — append at struct END)
- Modify: `src/host/shadow_chain_mgmt.h` (`chain_mgmt_host_t`)
- Modify: `src/host/shadow_chain_mgmt.c` (~994, `shadow_host_api` wiring)
- Modify: `src/schwung_shim.c` (cm_host init ~3866; `overtake_host_api` ~1458)
- Modify: `src/host/shadow_sampler.c` (`sampler_get_bpm` ~332)

**Interfaces:**
- Produces: `double (*get_beat_position)(void);` on `host_api_v1_t` — Task 4's LFO code and (later, Phase 3) movy's ffi read this.

- [ ] **Step 1: Append the member to `host_api_v1_t`** — at the **end** of the struct (append-only keeps ABI compat; every construction site memsets or brace-inits, so absent wiring reads NULL):

```c
    /* Beats since transport start of the active clock source (Move's native
     * sequencer, or an internal module's emitted clock), derived from
     * 24-PPQN realtime ticks and interpolated per block. Returns < 0 when
     * no transport is running — callers must fall back (e.g. LFO free-run).
     * Appended in 2026-07; may be NULL on older hosts, always guard. */
    double (*get_beat_position)(void);
```

- [ ] **Step 2: Thread it through the chain-mgmt host struct**

`shadow_chain_mgmt.h`, in `chain_mgmt_host_t` next to `get_bpm`:

```c
    double (*get_beat_position)(void);
```

`shadow_chain_mgmt.c`, next to the existing `shadow_host_api.get_bpm = host.get_bpm;` line:

```c
    shadow_host_api.get_beat_position = host.get_beat_position;  /* transport phase for LFO sync */
```

`schwung_shim.c` cm_host initializer (next to `.get_bpm = shim_get_bpm,`):

```c
            .get_beat_position = shadow_transport_beat_position,
```

`schwung_shim.c` overtake host api (next to `overtake_host_api.get_bpm = shim_get_bpm;`):

```c
    overtake_host_api.get_beat_position = shadow_transport_beat_position;
```

- [ ] **Step 3: Delegate tempo in `sampler_get_bpm`** — insert BEFORE the existing "1. Active MIDI clock" check (include `shadow_transport.h` at the top of the file):

```c
    /* 0. Internal transport (an overtake sequencer driving the clock).
     * Cable-0 (Move) clock is already covered by the measured-clock check
     * below, so only the internal source needs delegation. */
    if (shadow_transport_source() == TRANSPORT_SRC_INTERNAL) {
        float tbpm = shadow_transport_bpm();
        if (tbpm >= 20.0f) {
            if (source) *source = TEMPO_SOURCE_CLOCK;
            return tbpm;
        }
    }
```

- [ ] **Step 4: Compile-check + unit tests still pass**

```bash
cc -std=c11 -fsyntax-only -Isrc src/host/shadow_transport.c && echo OK
bash tests/host/test_shadow_transport.sh
```

Expected: `OK`, `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/host/plugin_api_v1.h src/host/shadow_chain_mgmt.h src/host/shadow_chain_mgmt.c \
        src/schwung_shim.c src/host/shadow_sampler.c
git commit -m "feat(host-api): get_beat_position() transport hook; internal transport drives get_bpm"
```

---

### Task 4: LFO phase-lock (slot + master FX)

**Files:**
- Modify: `src/host/lfo_common.h` (~201, next to `lfo_sync_rate_hz`)
- Modify: `src/modules/chain/dsp/chain_host.c` (`lfo_tick`, the `Phase accumulation` block)
- Modify: `src/host/shadow_chain_mgmt.c` (`shadow_master_fx_lfo_tick`, same block)
- Create: `tests/host/test_lfo_synced_phase.c`
- Create: `tests/host/test_lfo_synced_phase.sh`

**Interfaces:**
- Consumes: `host_api_v1_t.get_beat_position` (Task 3), `chain_mgmt_host_t.get_beat_position` (Task 3, as the `host` global in shadow_chain_mgmt.c).
- Produces: `static inline double lfo_synced_phase(double beat_position, int rate_div)` in `lfo_common.h`.

- [ ] **Step 1: Write the failing test**

`tests/host/test_lfo_synced_phase.c`:

```c
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "host/lfo_common.h"

static void fail(const char *m) { fprintf(stderr, "FAIL: %s\n", m); exit(1); }
static void near(double got, double want, const char *m) {
    if (fabs(got - want) > 1e-9) {
        fprintf(stderr, "FAIL: %s (got %f want %f)\n", m, got, want);
        exit(1);
    }
}

/* Find a division index by its beats value so the test doesn't hardcode
 * table order. */
static int div_index(float beats) {
    for (int i = 0; i < LFO_NUM_DIVISIONS; i++)
        if (fabsf(lfo_divisions[i].beats - beats) < 1e-6f) return i;
    fail("division not found in table");
    return -1;
}

int main(void) {
    int d1 = div_index(1.0f);   /* 1-beat cycle */
    int d4 = div_index(4.0f);   /* 1-bar cycle */

    near(lfo_synced_phase(0.0, d1), 0.0, "beat 0 -> phase 0");
    near(lfo_synced_phase(0.5, d1), 0.5, "half beat -> phase 0.5 on 1-beat div");
    near(lfo_synced_phase(7.0, d1), 0.0, "whole beats wrap to 0");
    near(lfo_synced_phase(6.0, d4), 0.5, "beat 6 -> phase 0.5 on 4-beat div");
    near(lfo_synced_phase(9.0, d4), 0.25, "beat 9 -> phase 0.25 on 4-beat div");
    /* Out-of-range division indexes clamp, never crash. */
    (void)lfo_synced_phase(1.0, -5);
    (void)lfo_synced_phase(1.0, LFO_NUM_DIVISIONS + 5);

    printf("PASS: test_lfo_synced_phase\n");
    return 0;
}
```

`tests/host/test_lfo_synced_phase.sh` (same shape as Task 1's runner; compiles only the test file — `lfo_common.h` is header-only — with `-Isrc -lm`).

- [ ] **Step 2: Run to verify it fails** — `bash tests/host/test_lfo_synced_phase.sh` → compile FAIL (`lfo_synced_phase` undeclared).

- [ ] **Step 3: Implement the helper in `lfo_common.h`** (directly under `lfo_sync_rate_hz`):

```c
/* Phase-locked LFO phase from a transport beat position (see
 * host_api_v1.get_beat_position). Drift-free by construction: phase is a
 * pure function of song position, so it stays bar-aligned forever. */
static inline double lfo_synced_phase(double beat_position, int rate_div) {
    if (rate_div < 0) rate_div = 0;
    if (rate_div >= LFO_NUM_DIVISIONS) rate_div = LFO_NUM_DIVISIONS - 1;
    return fmod(beat_position / (double)lfo_divisions[rate_div].beats, 1.0);
}
```

Run: `bash tests/host/test_lfo_synced_phase.sh` → `PASS`.

- [ ] **Step 4: Use it in `chain_host.c` `lfo_tick`** — replace the existing `/* Phase accumulation */` block (`if (lfo->sync) { ... } else { ... } lfo->phase = lfo_advance_phase(...)`) with:

```c
        /* Phase: when a transport is running, lock to song position (writing
         * lfo->phase keeps continuity — on stop, free-run resumes from the
         * locked phase instead of jumping). Otherwise free-run as before. */
        double bp = -1.0;
        if (lfo->sync && inst->host && inst->host->get_beat_position)
            bp = inst->host->get_beat_position();
        if (lfo->sync && bp >= 0.0) {
            lfo->phase = lfo_synced_phase(bp, lfo->rate_div);
        } else {
            float rate_hz;
            if (lfo->sync) {
                float bpm = 120.0f;
                if (inst->host && inst->host->get_bpm) bpm = inst->host->get_bpm();
                rate_hz = lfo_sync_rate_hz(bpm, lfo->rate_div);
            } else {
                rate_hz = lfo->rate_hz;
            }
            lfo->phase = lfo_advance_phase(lfo->phase, rate_hz, frames, sample_rate);
        }
```

- [ ] **Step 5: Same change in `shadow_chain_mgmt.c` `shadow_master_fx_lfo_tick`** — identical structure; the host struct there is the `host` global (`chain_mgmt_host_t`), so the calls are `host.get_beat_position` / `host.get_bpm` (guard `host.get_beat_position` non-NULL).

- [ ] **Step 6: Compile-check both + run all three unit tests**

```bash
cc -std=c11 -fsyntax-only -Isrc -Isrc/modules/chain/dsp src/modules/chain/dsp/chain_host.c 2>&1 | head -5
bash tests/host/test_shadow_transport.sh && bash tests/host/test_lfo_synced_phase.sh
```

Note: `chain_host.c` may need its sibling includes to syntax-check standalone — if `-fsyntax-only` is noisy for pre-existing reasons, rely on Task 5's full build instead; do not chase unrelated warnings.

- [ ] **Step 7: Commit**

```bash
git add src/host/lfo_common.h src/modules/chain/dsp/chain_host.c src/host/shadow_chain_mgmt.c \
        tests/host/test_lfo_synced_phase.c tests/host/test_lfo_synced_phase.sh
git commit -m "feat(lfo): phase-lock synced LFOs to transport beat position (slot + master FX)"
```

---

### Task 5: Schwung full build + existing test suite

**Files:** none (build + test only)

- [ ] **Step 1: Full cross-compile** — `./scripts/build.sh` (Docker). Expected: completes; `build/schwung-shim.so` exists and `nm -D build/schwung-shim.so | grep shadow_transport` shows the new symbols (or they're static-linked — absence from dynamic symbols is fine as long as the build succeeds).

- [ ] **Step 2: Run the schwung static/regression suite**

```bash
for t in tests/{host,shadow,store,build}/*.sh; do bash "$t" || echo "FAILED: $t"; done 2>&1 | tail -30
```

Expected: the two new tests PASS; pre-existing failures match the known-stale set (per schwung CLAUDE.md, ~20 stale failures pin since-moved code — compare against a pre-change run of the same loop on an unmodified worktree if unsure which are new). **Zero NEW failures.**

- [ ] **Step 3: Commit any build-script fix + push branch**

```bash
git push -u origin feat/transport-beat-clock
```

---

### Task 6: Movy engine — clock emission (TDD)

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (OutEvent enum ~12; `advance_block` ~518; Engine struct + `new` ~90; tests module)

**Interfaces:**
- Produces: `OutEvent::Start`, `OutEvent::Stop`, `OutEvent::Clock` (unit variants) — Task 7's drain consumes them.

- [ ] **Step 1: Write failing tests** (in the existing `#[cfg(test)]` module; reuse the `engine()` and `run_ticks()` helpers already there):

```rust
    #[test]
    fn clock_emits_start_then_24ppqn_ticks() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        // One beat = 96 master ticks; expect 0xFA once, then 96/4 = 24 clocks.
        let ev = run_ticks(&mut e, 96);
        let starts = ev.iter().filter(|x| matches!(x, OutEvent::Start)).count();
        let clocks = ev.iter().filter(|x| matches!(x, OutEvent::Clock)).count();
        assert_eq!(starts, 1);
        assert_eq!(clocks, 24);
        // The anchor tick precedes the first note of the pattern.
        let first_clock = ev.iter().position(|x| matches!(x, OutEvent::Clock)).unwrap();
        let first_note = ev
            .iter()
            .position(|x| matches!(x, OutEvent::NoteOn { .. }))
            .unwrap();
        assert!(first_clock < first_note);
    }

    #[test]
    fn clock_stop_emits_stop_once_and_goes_silent() {
        let mut e = engine();
        e.play();
        let _ = run_ticks(&mut e, 8);
        let mut out = Vec::new();
        e.stop(&mut out);
        // Stop is edge-detected in advance_block, so run one more block.
        e.advance_block(FRAMES, &mut out);
        let stops = out.iter().filter(|x| matches!(x, OutEvent::Stop)).count();
        assert_eq!(stops, 1);
        out.clear();
        for _ in 0..50 {
            e.advance_block(FRAMES, &mut out);
        }
        assert!(out.iter().all(|x| !matches!(x, OutEvent::Clock | OutEvent::Start)));
    }

    #[test]
    fn clock_exact_count_across_many_blocks() {
        let mut e = engine();
        e.play();
        // 4 beats = 384 master ticks -> exactly 96 clocks regardless of
        // block-boundary alignment (integer accumulator guarantees this).
        let ev = run_ticks(&mut e, 384);
        let clocks = ev.iter().filter(|x| matches!(x, OutEvent::Clock)).count();
        assert_eq!(clocks, 96);
    }
```

- [ ] **Step 2: Run to verify failure** — `cd engine && cargo test -p seq-core clock_emits` → compile FAIL (`Start` not found in `OutEvent`).

- [ ] **Step 3: Implement**

(a) OutEvent variants (after `Cc`):

```rust
    /// MIDI transport out (schwung transport service): 0xFA on play,
    /// 0xF8 at 24 PPQN while playing, 0xFC on stop — so schwung's synced
    /// LFOs/params phase-lock to this sequencer's grid.
    Start,
    Stop,
    Clock,
```

(b) Engine struct: add field `emitting_clock: bool` (init `false` in `new()`; runtime-only — do NOT touch `persist.rs`).

(c) `advance_block`:

```rust
    pub fn advance_block(&mut self, frames: u32, out: &mut Vec<OutEvent>) {
        let fired = self.clock.advance(frames);
        // Transport edges are detected here (play/stop arrive via commands
        // between blocks) so Start/Stop always pair correctly.
        if self.playing && !self.emitting_clock {
            self.emitting_clock = true;
            out.push(OutEvent::Start);
        } else if !self.playing && self.emitting_clock {
            self.emitting_clock = false;
            out.push(OutEvent::Stop);
        }
        if !self.playing {
            return;
        }
        for _ in 0..fired {
            // 96-PPQN master clock -> 24-PPQN MIDI clock, emitted before the
            // tick is serviced so 0xF8 aligns with that tick's notes.
            if self.master_tick % 4 == 0 {
                out.push(OutEvent::Clock);
            }
            self.service_tick(out);
        }
    }
```

- [ ] **Step 4: Run the full engine suite** — `cargo test` (workspace). Expected: all pass, including the 3 new tests.

- [ ] **Step 5: Commit**

```bash
git add crates/seq-core/src/engine.rs
git commit -m "feat(engine): emit MIDI transport (Start/Clock 24ppqn/Stop) while playing"
```

---

### Task 7: Movy DSP — forward transport + version bump + local suites

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`drain_out` ~83; `ENGINE_VERSION` const)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION`)

**Interfaces:**
- Consumes: `OutEvent::{Start, Stop, Clock}` (Task 6); `host::midi_send_internal(status, d1, d2)` (existing — already builds the 4-byte `[CIN, status, d1, d2]` packet, giving CIN `0x0F` for `0xF8+`, which matches `overtake_midi_send_internal`'s `len >= 4` contract).

- [ ] **Step 1: Extend `drain_out`** — add match arms:

```rust
                OutEvent::Start => {
                    host::midi_send_internal(0xFA, 0, 0);
                }
                OutEvent::Stop => {
                    host::midi_send_internal(0xFC, 0, 0);
                }
                OutEvent::Clock => {
                    host::midi_send_internal(0xF8, 0, 0);
                }
```

- [ ] **Step 2: Bump `ENGINE_VERSION`** by +1 in BOTH `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` (grep for the current value; they must be identical).

- [ ] **Step 3: Run the complete movy local suite**

```bash
cd /Users/dake/git/cld/movy
(cd engine && cargo test)
npm test          # builds, then logic.mjs, app-loop.mjs, screenshot.mjs, perf.mjs
```

Expected: cargo all-pass; all four .mjs suites 0 failures. No UI rendering changed, so **no baseline updates should be needed** — if screenshot.mjs fails, something is wrong; investigate, don't blindly regenerate.

- [ ] **Step 4: Commit + push**

```bash
git add engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "feat(dsp): forward engine transport events as internal MIDI clock (0xFA/0xF8/0xFC)"
git push
```

---

### Task 8: Device deployment + e2e + perf comparison

**Files:** none (device only). Requires `move.local` reachable; otherwise report `DEVICE OFFLINE — DEVICE VERIFICATION SKIPPED` in CAPS and stop here.

- [ ] **Step 1: Capture the BEFORE baseline** (unmodified schwung + current movy):

```bash
cd /Users/dake/git/cld/movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok || { echo "DEVICE OFFLINE"; exit 1; }
./scripts/test.sh 2>&1 | tee /tmp/movy-perf-before.log     # note the perf timing lines
```

- [ ] **Step 2: Deploy modified schwung**

```bash
cd /Users/dake/git/cld/schwung-transport
./scripts/install.sh local --skip-modules --skip-confirmation
```

Rollback if anything breaks: `./scripts/install.sh` (reinstalls the stock GitHub release). If MoveOriginal wedges, the davebox restart sequence (root SSH, user-run) is in `movy/CLAUDE.md`.

- [ ] **Step 3: Deploy movy + run both device suites**

```bash
cd /Users/dake/git/cld/movy
./scripts/test.sh      2>&1 | tee /tmp/movy-perf-after.log
./scripts/test-seq.sh                                     # deploys dsp.so too
```

Expected: both PASS. Compare perf timing lines between `/tmp/movy-perf-before.log` and `-after.log` — must be within noise (design §5b).

- [ ] **Step 4: Functional LFO-lock verification**

```bash
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on; > /data/UserData/schwung/debug.log'
```

Then, scripted where the existing harness supports it (crib the pattern from `scripts/test-seq.sh` / `scripts/test-auto.sh` — MIDI inject via `schwung-midi-inject-ui.py`, log-grep for assertions), otherwise as a documented manual check:

1. Open movy, set a slot LFO: `sync=on`, division = 1 bar, shape = saw, high depth, target = an audible synth param. Set movy tempo to 60 BPM.
2. Start the movy sequencer. **PASS criteria:** the modulation completes exactly one cycle per bar (4 s at 60 BPM), the cycle restarts on the bar downbeat, and it stays aligned after several minutes (drift-free). Change tempo to 120 → cycle becomes 2 s, still bar-aligned.
3. Stop movy; start Move's native sequencer (suspend/exit movy UI as needed). **PASS criteria:** the same LFO locks to Move's bars at Move's tempo.
4. Stop both. **PASS criteria:** the LFO keeps free-running (no freeze), at the last-known tempo.

Record what was verified (and how) in the final report — no unverified success claims.

- [ ] **Step 5: Commit any device-found fixes** (schwung branch and/or movy main, with the failing observation in the commit message).

---

### Task 9: Docs + wrap-up

**Files:**
- Modify: `schwung-transport/docs/API.md` (host API section — document `get_beat_position` semantics: 24-PPQN-derived, block-interpolated, < 0 when stopped, NULL-guard note)
- Modify: `movy/MANUAL.md` (LFO page section: synced mode now phase-locks to the playing transport — movy's sequencer, or Move's when it runs; free-runs at tempo when stopped)

- [ ] **Step 1: Make both doc edits** (match each doc's existing voice; no screenshots needed — no visual change).
- [ ] **Step 2: Commit + push both repos**

```bash
cd /Users/dake/git/cld/schwung-transport && git add docs/API.md && git commit -m "docs: get_beat_position host API" && git push
cd /Users/dake/git/cld/movy && git add MANUAL.md && git commit -m "docs: LFO synced mode phase-locks to the transport" && git push
```

- [ ] **Step 3: Report to the user:** what shipped, device verification results (or DEVICE OFFLINE), the schwung branch name (`feat/transport-beat-clock`) and that opening the upstream PR to charlesvestal/schwung is their call. Do NOT open the PR unprompted.

---

## Self-review notes (done at plan time)

- Spec coverage: §3.1→Tasks 1–2, §3.2→Task 3, §3.3→Task 4, §3.4→Tasks 6–7, §5→Tasks 1/4/6/7, §5b→Tasks 7 (suites) + 8 (device before/after), §6 RT rules→Global Constraints. Phase 2/3 items intentionally out of scope.
- Line numbers are origin/main@bde822df anchors; Task 0 Step 2 re-verifies every seam by grep before any edit.
- Type consistency: `transport_src_t` values, `shadow_transport_*` signatures, `lfo_synced_phase`, and `OutEvent` variants are used identically across tasks.
