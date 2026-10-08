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
