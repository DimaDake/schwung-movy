/* Schwung's on-screen keyboard, opened at load and allowed to stay shut.
 *
 * Same door as schwung-lib.ts and for the same reason: a STATIC import of a
 * shared module is a load-time dependency, and a Schwung without the file
 * would stop movy starting at all. `import()` in try/catch turns that into
 * "rename is unavailable". Top-level await is safe here only because it runs
 * while ui.js is being evaluated (see schwung-lib.ts). */

export interface TextEntry {
    openTextEntry(o: { title: string; initialText: string;
                       onConfirm: (text: string) => void; onCancel: () => void }): void;
    closeTextEntry(): void;
    isTextEntryActive(): boolean;
    handleTextEntryMidi(msg: number[]): void;
    tickTextEntry(): void;
    drawTextEntry(): void;
}

let lib: TextEntry | null = null;
try {
    // @ts-ignore — absolute device path; external in the device build
    lib = (await import('/data/UserData/schwung/shared/text_entry.mjs')) as unknown as TextEntry;
} catch {
    lib = null;
}

export function textEntry(): TextEntry | null { return lib; }

/** True while the keyboard owns the screen and every control. */
export function textEntryActive(): boolean { return !!lib && lib.isTextEntryActive(); }
