export function basename(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
}

/* Overlay labels are truncated to 12 characters, so an extension costs a third
 * of the name and tells the user nothing they didn't get from the param
 * ("808 Kit.jso"). Only strips an extension the param itself declared, so a dot
 * inside a kit name is never mistaken for one. */
export function stripKnownExt(name: string, filter: string[]): string {
    const lower = name.toLowerCase();
    for (const ext of filter) {
        if (ext && lower.endsWith(ext)) return name.slice(0, name.length - ext.length);
    }
    return name;
}

export function dirname(path: string): string {
    if (!path) return '/';
    const i = path.lastIndexOf('/');
    if (i <= 0) return '/';
    return path.slice(0, i);
}
