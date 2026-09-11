# Releasing Movy

Movy is distributed through the Schwung module store. The store reads
`release.json` from this repo's `main` on every check, so a release reaches
users the moment that file lands — the GitHub release and its asset must exist
first.

## The steps

1. **Reconcile the changelog.** Diff `git log v<prev>..HEAD` against the
   `[Unreleased]` section. Feature work that never got a bullet is the normal
   failure here, and so is prose that describes an earlier state of a feature
   that changed later in the window. Re-grep gesture wording against the code
   rather than trusting the bullet: a gesture renamed mid-window leaves the
   changelog describing a control that no longer exists.

2. **Bump `module.json` and `release.json` together**, and rename
   `[Unreleased]` to `[X.Y.Z] — YYYY-MM-DD`. The two versions must match or the
   store re-offers the update forever; `build-module.sh` refuses to build if
   they disagree.

3. **Bump `ENGINE_VERSION`** (`engine/crates/movy-dsp/src/lib.rs` +
   `src/seq/constants.ts`) if engine *behaviour* changed since the last release
   — not only its command surface. Check with
   `git diff --stat v<prev>..HEAD -- engine/`; an empty diff means leave it
   alone. The `ping` handshake is what tells the UI a stale `dsp.so` is still
   loaded, so an unbumped version lets an old engine pass as current.

4. **Regenerate the doc assets** and let git say what moved:

   ```bash
   node scripts/make-doc-assets.mjs $(ls docs/assets/*.png | xargs -n1 basename | sed 's/\.png$//')
   ```

   They go stale silently, and the count is not predictable from the diff — one
   page's change has moved 47 of 105 assets before now. If the screenshot
   baselines had zero drift, the assets cannot have drifted either (they are 4x
   upscales of those same baselines) and this can be skipped.

5. **Write the announcement** at `docs/discord-v<X.Y.Z>.md`. Discord caps a
   message at **2000 characters**; aim well under. `build-module.sh` refuses to
   build without it, so it is written before the release exists rather than
   after it is already public.

   Lead with what a user *gets*, not with the version's internal content: most
   readers install whatever the store currently offers, so a post about one
   version is read as the state of the module. Put anything that can bite —
   a raised `min_host_version`, a changed default — where it will be seen.

6. **Run the gates.** `npm test` (8 suites, 0 failures) and the device sweep
   (`scripts/test-all-device.sh`). Device suites are flaky: run once, and
   check a failure against what actually changed before chasing it. A failure
   in a suite that greps a log phrase is often test rot rather than a
   regression — the phrase moved upstream.

7. **Build, commit, push, release.**

   ```bash
   ./scripts/build-module.sh                       # → dist/movy-module.tar.gz
   gh release create vX.Y.Z --repo DimaDake/schwung-movy \
       --notes-file <notes> dist/movy-module.tar.gz
   ```

8. **Verify the store path end to end** — the one check that catches a dead
   release:

   ```bash
   curl -s https://raw.githubusercontent.com/DimaDake/schwung-movy/main/release.json
   curl -sIL -o /dev/null -w '%{http_code}\n' <download_url>   # must be 200
   ```

9. **Announce it**, once the store is really serving it:

   ```bash
   node scripts/announce-release.mjs --watch
   ```

   It waits until the catalog carries the entry, `release.json` on the default
   branch advertises this version, and the asset it points at actually
   downloads — then prints `docs/discord-v<X.Y.Z>.md` for you to post. The tag
   is not that moment: announcing on the tag can tell people to update to
   something the store is not offering yet, or never will if the asset upload
   failed.

   **Posting is manual, by design.** The announcement goes to a Discord channel
   the project does not own, so there is no webhook to automate it with — and a
   send path that cannot be tested end to end is worse than none, because it
   becomes the release step nobody checks. The script tells you *when*, and
   hands you the text.

## The catalog

`module-catalog.json` in `charlesvestal/schwung` carries Movy's entry, and it
holds **no version field** — the host reads `{version, download_url}` from
`release.json` on `main` dynamically. A normal release therefore needs no
catalog PR.

Open one only to change the repo, branch, asset name, or `min_host_version`.
When editing it, patch the lines **textually**: the file mixes literal and
`\u`-escaped punctuation, so a `json.dump` round-trip rewrites other authors'
entries whichever `ensure_ascii` you choose. Anchor `min_host_version` on the
entry's `asset_name` — the same version string appears on other modules.

## A same-version re-release only reaches new installers

The store compares `release.json`'s version. Replacing a tag and clobbering the
asset does **not** re-offer the update to anyone who already took that version.
Once a release has been public long enough for anyone to have installed it, the
fix is the next patch version, not a re-release.
