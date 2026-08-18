export type ArtworkUrlResolver = (path: string | null) => Promise<string | null>

const directArtworkUrl: ArtworkUrlResolver = async path => /^(?:data:|blob:|https?:)/i.test(path ?? '') ? path : null

let resolver: ArtworkUrlResolver = directArtworkUrl

/** Web wires its storage resolver here; the package itself never performs I/O. */
export function configureArtworkUrlResolver(next: ArtworkUrlResolver): void {
  resolver = next
}

export function resolveArtworkUrl(path: string | null): Promise<string | null> {
  return resolver(path)
}
