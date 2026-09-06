# MIX page knob fixes

Six issues reported from the device after the MIX page shipped. Root causes
below; each is independent, so they land as separate commits.

## 1. Knob sensitivity — matched to a module knob

**Reported:** "all knobs should have sensitivity like regular 0-100% knobs on
modules; currently too sensitive. For pan, setting 0 must be possible."

**Root cause:** the MIX page steps in whole ladder detents — `countDetents`
(8 CC units per detent) then one whole dB (VOL/sends) or 1/32 of the travel
(PAN). Measured against a module knob, which moves `MIN_STEP_RANGE_FRAC ×
ARC_DELTA_SCALE` = 0.5 % of its range per CC unit (~200 units per sweep), the
MIX knobs need ~500 units per sweep AND arrive in visible jumps. The jumps are
what reads as "too sensitive": a small turn does nothing, then the value leaps a
whole dB.

Pan also could not return to centre: the step was added to whatever value was
already there, so a pan restored off the detent grid (a set file, an automation
write) never landed on 0 again.

**Fix:** step continuously at the module knob's own rate — 0.5 % of the
control's travel per CC unit — and snap the result to a display-sized grid so
the landmarks (0.0 dB, C) are always reachable:

| control | travel          | per CC unit | grid   |
|---------|-----------------|-------------|--------|
| VOL     | -48 dB .. +12 dB| 0.30 dB     | 0.1 dB |
| SND1-3  | -48 dB .. 0 dB  | 0.24 dB     | 0.1 dB |
| PAN     | L100 .. R100    | 0.01        | 0.01   |

The dB ladder stays as the CURVE (and the hold-track+volume gesture keeps its
one-dB-per-detent feel — it was not reported and is not touched); what changes
is that the MIX page walks it continuously instead of index by index.

## 2. VOL draws as a fader

`renderStyle: 'vbar'` — `drawFader` already exists and is what the pan dial was
drawn to pair with ("horizontal, where the fader is vertical").

## 3. Labels use the cell's full width

`dedupShortNames(entries, 5)` caps every knob label at five CHARACTERS. The font
is proportional: five M's are 31 px in a 32 px cell, but "CUTOFF" is 30 px and
was cut to "CUTOF" anyway. The cap becomes a PIXEL budget, so narrow labels get
their sixth and seventh letters and wide ones are unchanged.

## 4. A send's full travel ends at 0 dB

`normalizedValue` came from `volumeFrac`, whose travel runs to +12 dB — so a
send at its maximum (0 dB, `SEND_MAX`) drew at 79 % of the arc and looked stuck.
Sends normalize over their OWN travel (silence .. 0 dB).

## 5. Both held knobs highlight

`buildMixVM` marked only the last-touched cell. The module page marks every
touched slot (`s.touchedSlots.includes(...)`) and uses the last only for the
header toast; the MIX page now does the same.

## 6. Automation scaling

**Reported:** automating a MIX param leaves the knob "stuck on one side".

**Root cause:** a lane's 0-127 is denormalized LINEARLY over the field's range —
`norm7(value, min, max)` in the UI, `MixField::denorm` in the engine — while the
knob and the page work on the dB ladder. Unity is 1.0 of a 0..4 range, so it
sits at lane value 32: three quarters of the lane travel covers the top 12 dB
and the whole usable fader is squeezed into the bottom quarter.

**Fix:** a mix lane's 0-127 IS the fader position (the same curve the knob
walks), in the UI and in the engine, so the automated value and the knob agree
at every point. Engine change → ENGINE_VERSION bump + restart.

## Tests

- `browser-test/logic/mixer.mjs`: per-CC-unit travel for VOL/PAN/SND against the
  module knob's own constant; pan returns to exactly 0 from an off-grid start;
  send at SEND_MAX is a full arc; both touched cells highlighted.
- Screenshot: the MIX page with the fader, and a two-knob touch.
- `browser-test/logic/shorten.mjs`: the width budget.
- Device: `scripts/test-sends.sh`, `scripts/test-auto.sh`.

## Note for the next session

`PAN_STEP` was a module-level `const` computed from another module's exports.
In the code-split ESM build esbuild put the consumer chunk's initializer BEFORE
the exporter's `var`, so `PAN_STEP` was NaN and every pan edit wrote `NaN` —
invisible on device (the single-file bundle happens to order it correctly) and
untested, because no test drove a pan edit. Values a module derives from another
module's constants at load time are a hazard in this build; derive them inside
the function instead.
