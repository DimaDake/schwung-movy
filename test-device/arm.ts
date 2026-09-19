import type { Probe } from './probe.js';
import type { Ctx } from './runner.js';

/* WHICH ARM A SCENARIO GRADES, and who sets it.
 *
 * `prefs.flags.schwunggrid` has three values (`off`/`body`/`page`), and it is a
 * user-visible setting the device RESTS at — read back as `2`, the `page` arm,
 * on 2026-09-19. In that arm Schwung plans AND draws: `pageOwnerOf` hands the
 * component over (`src/app/page-owner.ts`), movy takes no knob input (`src/
 * midi/router.ts` sends the turn to `owner.page.knobTurn` instead of
 * `applyKnobDelta`) and refreshes nothing (`src/app/tick.ts` skips
 * `refreshOneParam`). So a scenario whose checks grade movy's OWN work — the
 * knob write, the commit, the hierarchy read, the refresh instrumentation —
 * measures nothing on a box at rest, and reports feature failures that are
 * really a setting.
 *
 * That is not a defect, and it is not the operator's job to fix it: a gate that
 * is red by design is a gate people stop reading, and a check that demands a
 * human set a flag is a check that gets run wrong. So a scenario that grades
 * movy's own work owns its own precondition and sets the arm itself, the way
 * `page-lifecycle.ts` arms `page` for the opposite reason (it IS grading the
 * delegated path).
 *
 * AN OVERRIDE, NOT THE FLAG. `probe.setGridMode` writes nothing — it is the
 * module-scope `override` in `src/renderer/schwung-grid.ts` — so the device's
 * own prefs are never touched and nothing here has to be restored afterwards.
 *
 * It does NOT survive a reopen: `openTool` re-evaluates `ui.js` and the
 * override is a module-level `let`, so a scenario that parks and resumes MUST
 * call `armMovy` again afterwards. `smoke.ts` does.
 *
 * ONE VALUE FOR THREE SCENARIOS, on purpose. `smoke`, `items` and
 * `module-contract` all grade movy's own work, so they all need this arm; the
 * reason is long and belongs in one place, and a literal copied into three
 * files is a set that silently drifts apart — at which point the argument above
 * stops holding for whichever one moved. */
export const MOVY_ARM = 'off';

/* Sets the arm, ASSERTS the arm took, and returns the one the RENDERER reports.
 * That is `schwungGridMode()`'s own answer over the probe (`src/test/probe.ts`),
 * not the flag file the arm is derived from, so the check is on what the
 * scenario actually ran in rather than on what it asked for. `null` means the
 * probe answered no page at all.
 *
 * THE CHECK IS IN HERE, NOT AT THE CALL SITES, and that is the point. This used
 * to return the renderer and leave the asserting to the caller: `smoke` did it,
 * `items` and `module-contract` only NOTED it, so a silent arming failure in
 * either of those graded the wrong renderer and still went green — the same
 * false-green class as a `SCHWUNG=`-less build, where a suite that measured
 * nothing reports the fix as working. A return value is only a guard if every
 * caller spends it, which is not a property one can keep. Registering the check
 * where the arm is set is also what fixes the callers that do not exist yet.
 *
 * `id` is a parameter because `smoke` arms twice around a reopen; a second check
 * under the same id would aggregate two different moments into one ledger row. */
export async function armMovy(t: Ctx, probe: Probe, id = 'arm-taken'): Promise<string | null> {
    const p = await probe.setGridMode(MOVY_ARM) as { renderer?: string } | null;
    const renderer = p?.renderer ?? null;
    const okArm = renderer === MOVY_ARM;
    t.check(id, `the renderer is the arm this scenario set ('${MOVY_ARM}')`, okArm, {
        expected: `the renderer at '${MOVY_ARM}'`,
        actual: okArm
            ? `renderer=${renderer}`
            : `the renderer did not answer '${MOVY_ARM}'${renderer === null
                ? ' (the probe gave no page at all, so the arm cannot be confirmed)'
                : `, it answered '${renderer}'`} — everything graded below is movy's OWN work and in any `
              + `other arm Schwung owns it, so this scenario would grade a renderer it did not set`,
    });
    return renderer;
}
