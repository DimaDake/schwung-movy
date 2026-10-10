/* Stand-in for Schwung's shared/text_entry.mjs in the browser suites. The real
 * keyboard draws through Schwung's own globals and is Schwung's to test; movy's
 * half is what it OPENS the keyboard with and what it does with the answer, so
 * this records the open and lets a test answer it. */
let open = null;
export function openTextEntry(o) { open = o; globalThis.__textEntryLast = o; }
export function closeTextEntry() { open = null; }
export function isTextEntryActive() { return open !== null; }
export function handleTextEntryMidi(_msg) {}
export function tickTextEntry() {}
export function drawTextEntry() { globalThis.__textEntryDrawn = (globalThis.__textEntryDrawn || 0) + 1; }
/* Test hooks: answer the keyboard the way a user would. */
globalThis.__textEntryConfirm = (text) => { const o = open; open = null; o && o.onConfirm(text); };
globalThis.__textEntryCancel = () => { const o = open; open = null; o && o.onCancel(); };
