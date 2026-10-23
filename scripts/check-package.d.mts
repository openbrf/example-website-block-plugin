/** Every sentence the catalog would refuse this tarball with; none when it passes. */
export function tarballProblems(bytes: Uint8Array): string[];

/** Packs the package as `npm pack` would publish it, and returns the tarball's bytes. */
export function packTarball(): Buffer;
