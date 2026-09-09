## Movy v0.34.0 — Set backups

**Every Set now keeps its own history.** Movy kept two rotating copies of your sequence, but both are rewritten every few seconds — a crash guard, not an undo. Each Set now keeps up to **32 older versions**.

One is kept when you **open** a Set (a snapshot of what was on disk before Movy can touch it), roughly every ten minutes of work, when you **leave**, and always **before** anything that would wipe it. They thin on a ladder, not a queue — the last hour in detail, today by the hour, this week by the day — so a long session can't push out the take you actually wanted.

**Settings → BACKUPS** lists them by age, reason and clip count; the clip count is the fastest way to spot the one that still has your work. Jog scrolls, Shift+jog jumps eight, jog click confirms before restoring. Restoring is itself undoable, since the state you had is kept first.

Sets from earlier builds are **adopted**, so the menu is useful immediately.

**Also fixed**
• After a store update the old engine is still running until you restart, and every Set failed behind `ENGINE DID NOT START`. Movy now says *"Movy was updated — restart your Move"*.
• A failure screen no longer offers `JOG CLICK = START EMPTY` for engine failures, where the Set is fine and blanking it can't help — that click could overwrite a good Set.

**Heads up:** Movy no longer patches Schwung to keep the master FX chain saved — Schwung 1.1.0 fixed it upstream. **Movy now needs Schwung 1.1.0+.**
