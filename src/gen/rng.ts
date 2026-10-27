/* Seeded randomness. Every choice a generator makes is a function of the Set,
 * its knobs and SEED, so a preview regenerates identically and a bench run is
 * repeatable. */

export type Rng = () => number;

/** mulberry32: small, fast, and good enough for musical choices. */
export function rng(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** FNV-1a over a string: a stable seed from anything printable. */
export function hash(s: string): number {
    let h = 0x811C9DC5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

export function mix(...xs: number[]): number {
    let h = 0x9E3779B9;
    for (const x of xs) h = Math.imul(h ^ (x >>> 0), 0x85EBCA6B) >>> 0;
    return (h ^ (h >>> 13)) >>> 0;
}

export const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];

/** Fisher–Yates on a copy. */
export function shuffled<T>(r: Rng, a: readonly T[]): T[] {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** k distinct indices of 0..n-1, chosen by r, ascending. */
export function choose(r: Rng, n: number, k: number): number[] {
    return shuffled(r, Array.from({ length: n }, (_, i) => i)).slice(0, Math.max(0, Math.min(n, k))).sort((a, b) => a - b);
}
