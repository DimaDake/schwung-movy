/* Enum param I/O format. Schwung modules disagree on how an enum value is
 * exchanged: some speak the option NAME ("1/8."), others the numeric INDEX
 * ("3"). Stock shadow_ui.js resolves this per-call by probing the current
 * value — if it matches an option it's name-based, otherwise index-based
 * (shadow_ui.js `pluginUsesIndex = options.indexOf(currentVal) < 0`). The chain
 * forwards the value verbatim to the module, so movy must send whichever format
 * the module already reports. These helpers mirror that contract; the per-param
 * format is cached (ModelState.enumFmt) so reads/writes need no extra IPC. */


/* True if the module reports this enum as an index (raw value not a known
 * option name). Unknown raw (null) defaults to index — the legacy format, so a
 * never-read enum behaves exactly as before. */
export function enumUsesIndex(options: string[] | null | undefined, raw: string | null): boolean {
    if (!options || !options.length || raw === null) return true;
    return options.indexOf(raw) < 0;
}

