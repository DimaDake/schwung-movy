/* The UI thread: ui.js in QuickJS, ticked the way shadow_ui ticks an overtake
 * module (input, batched encoder deltas, tick(), pack the screen). */
#ifndef MH_UI_H
#define MH_UI_H

/* Blocks until g_mh_quit; returns the process exit code. */
int ui_run(const char *ui_path);

#endif
