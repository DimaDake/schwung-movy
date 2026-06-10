export function basename(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
    if (!path) return '/';
    const i = path.lastIndexOf('/');
    if (i <= 0) return '/';
    return path.slice(0, i);
}
