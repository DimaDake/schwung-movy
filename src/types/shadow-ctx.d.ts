/* Types for shadow_ui.js's published context object, which chain/master-mirror.ts
 * imports by its absolute device path. tsconfig `paths` maps that specifier
 * here — a leading-slash specifier is rooted-relative to TS, so an ambient
 * `declare module` would never match it.
 *
 * Untyped on purpose. `ctx` is documented for fork view modules, not tools, so
 * nothing on it is a stable API; master-mirror.ts probes every property.
 *
 * Remove with chain/master-mirror.ts when the upstream fix lands.
 */
export const ctx: Record<string, unknown> | undefined;
