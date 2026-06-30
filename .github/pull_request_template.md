<!-- Thanks for contributing to Movy! Keep PRs focused. See CONTRIBUTING.md. -->

## What & why

<!-- What does this change, and why? Link any related issue (e.g. "Closes #12"). -->

## How it was tested

<!-- Which suites did you run? Note if you couldn't run device tests. -->

- [ ] `npm run typecheck` is clean
- [ ] `npm test` passes (logic, app-loop, screenshot, perf)
- [ ] Screenshot baselines updated if rendering changed
- [ ] `cargo test` passes (if `engine/` changed)
- [ ] Device e2e run (`./scripts/test.sh` / `test-seq.sh`), or noted why not

## Checklist

- [ ] New rendering → a screenshot test; new logic → a logic test
- [ ] No code duplication; shared logic factored out
- [ ] Files stay within the 200-line cap
- [ ] Comments explain **why**, not what
