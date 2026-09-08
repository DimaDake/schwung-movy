<!-- Filed upstream as https://github.com/charlesvestal/schwung/issues/474 -->

# Proposal: atomic module install (schwung)

## Summary

Installing a module update writes the new `dsp.so` **over the running one, at the same inode**, while the old copy is still `dlopen`ed. For any module that ships a DSP this makes a store update either a no-op the user cannot see through (the old code keeps running) or a write into a mapped library. Both were reported in the field this week after a Movy update: users landed on a screen saying the engine would not start, and no Set would open, until the Move was power-cycled.

The fix is small and local to the installer: unpack to a temporary path and `rename()` into place, so the update gets a fresh inode and the running copy is left alone.

## What happens today

`host_extract_tar_strip` (`src/host/js_host_common.c`) shells out to `tar -xzf … -C …`. BusyBox tar truncates and rewrites in place rather than unlinking first. Measured on a Move:

```
$ mkdir -p /tmp/inotest/movy; echo old > /tmp/inotest/movy/dsp.so
$ stat -c %i /tmp/inotest/movy/dsp.so     # 9380
$ tar -xzf /tmp/m.tar.gz -C /tmp/inotest
$ stat -c %i /tmp/inotest/movy/dsp.so     # 9380   ← same inode
```

Two consequences, depending on whether the module's DSP is loaded at the time:

1. **It is loaded.** The new bytes go into the file backing a live mapping, so what the process executes can become a mixture of the two binaries depending on which pages had already been faulted in. This is the case Movy's own deploy script exists to avoid.

2. **It was loaded earlier in this boot.** `dlopen` on the same path returns the library already loaded under it, so the shim answers with the old code however many times the module asks for a reload. From the module's side the update simply never lands.

Case 2 is what the reports look like. Movy gates on an engine version string and re-issues `overtake_dsp:load` when it does not match; the shim answers with the previous engine every time, Movy gives up after its retry budget, and the tool cannot open any Set because its engine never came up. Nothing short of a restart of MoveOriginal clears it, and nothing on the device says so.

## Why it does not show up in development

Module authors deploy with a script, and the working ones already avoid this. Movy's `deploy.sh` scp's to a temporary name and `mv`s it into place — that is where its own note *"never scp over a dlopen'd dsp.so in place — overwriting a mapped .so's inode corrupts its pages and crashes MoveOriginal"* comes from — and it restarts the stack whenever the shipped `dsp.so` changes. Every dev and CI run is therefore on a clean stack with a fresh inode. The store path has neither property, so this is only reachable by end users.

## Proposal

**1. Atomic install (the fix).** Unpack into a staging directory beside the destination and `rename()` each file into place, or unpack the tree and rename the directory. `rename(2)` is atomic within a filesystem and gives every replaced file a new inode, so:

- a mapped `.so` is never written through — the old inode stays intact for as long as something holds it open;
- a subsequent `dlopen` of the path opens the new file rather than the resident one;
- a failed or interrupted download cannot leave a half-written module in place.

A minimal version stays inside `host_extract_tar_strip`: extract to `<dest>/.staging-<pid>/`, rename entries in, remove the staging dir. Modules that ship only `ui.js` and JSON are unaffected either way, since those are read fresh.

**2. Tell the user when a restart is required.** Even with atomic install, a module whose DSP is *currently* loaded keeps running the old code until it is reopened or the stack restarts. The manager knows it just replaced a `dsp.so`; surfacing "restart to finish updating this module" turns a silent half-update into an instruction. (Movy now detects the mismatch itself and says `MOVY WAS UPDATED / RESTART YOUR MOVE`, but it can only do that because it version-gates its own engine — most modules cannot.)

**3. Optional: refuse the swap while the module is the live overtake DSP**, or unload it first. Not required if 1 and 2 land; it just removes the window entirely.

## Impact

Every module in the catalogue that ships a `dsp.so` and gets a second release. The failure mode is worse the more the module depends on its DSP: for Movy it meant no Set would open, and the only thing standing between "the update did not take" and a corrupted mapping is whether the user had opened that tool since boot.

For reference, the install path today is `installModule` in `src/shared/store_utils.mjs` — download, `host_ensure_dir(extractDir)`, `host_extract_tar` straight over the live module directory, `host_rescan_modules()`. No staging, no unload, no restart prompt.

Happy to prepare the patch for (1) if the approach looks right.
