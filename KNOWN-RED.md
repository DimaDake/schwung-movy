# Known red

A device check that is red on `main` before your change does not block your
commit, but it has to be listed here. Each row is a loan, not a pass: the
device tier prints every row at the end of a run, and a row older than
**2 days** turns the tier red until it is fixed (delete the row in the fixing
commit) or the user agrees to extend it (update the date).

Before adding a row, re-run just those scenarios once
(`npm run test:device -- --scenario a,b`). If they go green, it was device
state, not a bug, so there is nothing to list.

| since | check | owner | why / next step |
| --- | --- | --- | --- |
| 2026-10-04 | page-dive#file-param-click-opens-the-browser, page-dive#dive-commit-lands-in-the-parameter | claude | Red on a302efa with no change applied (re-run twice). Appeared with the device's Schwung going 1.5.0 → 1.7.3: no cell on the first three pages opens the file browser. Next: diff the 1.7.3 file-param/dive path against the harness's assumptions. |
